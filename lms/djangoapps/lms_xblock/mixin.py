"""
Namespace that defines fields common to all blocks used in the LMS
"""

#from django.utils.translation import ugettext_noop as _
from lazy import lazy
from xblock.core import XBlock
from xblock.fields import Boolean, Dict, Scope, String, XBlockMixin
from xblock.validation import ValidationMessage

from lms.lib.utils import get_parent_unit
from xmodule.modulestore.inheritance import UserPartitionList
from xmodule.partitions.partitions import NoSuchUserPartitionError, NoSuchUserPartitionGroupError

# Please do not remove, this is a workaround for Django 1.8.
# more information can be found here: https://openedx.atlassian.net/browse/PLAT-902
_ = lambda text: text

INVALID_USER_PARTITION_VALIDATION = _(u"This component's access settings refer to deleted or invalid group configurations.")
INVALID_USER_PARTITION_GROUP_VALIDATION_COMPONENT = _(u"This component's access settings refer to deleted or invalid groups.")
INVALID_USER_PARTITION_GROUP_VALIDATION_UNIT = _(u"This unit's access settings refer to deleted or invalid groups.")
NONSENSICAL_ACCESS_RESTRICTION = _(u"This component's access settings contradict the unit's access settings.")
NONSENSICAL_ACCESS_RESTRICTION = _(u"This component's access settings contradict its parent's access settings.")


class GroupAccessDict(Dict):
    """Special Dict class for serializing the group_access field"""
    def from_json(self, access_dict):
        if access_dict is not None:
            return {int(k): access_dict[k] for k in access_dict}

    def to_json(self, access_dict):
        if access_dict is not None:
            return {unicode(k): access_dict[k] for k in access_dict}


@XBlock.needs('partitions')
@XBlock.needs('i18n')
class LmsBlockMixin(XBlockMixin):
    """
    Mixin that defines fields common to all blocks used in the LMS
    """
    hide_from_toc = Boolean(
        help=_("Whether to display this module in the table of contents"),
        default=False,
        scope=Scope.settings
    )
    format = String(
        # Translators: "TOC" stands for "Table of Contents"
        help=_("What format this module is in (used for deciding which "
               "grader to apply, and what to show in the TOC)"),
        scope=Scope.settings,
    )
    chrome = String(
        display_name=_("Course Chrome"),
        # Translators: DO NOT translate the words in quotes here, they are
        # specific words for the acceptable values.
        help=_("Enter the chrome, or navigation tools, to use for the XBlock in the LMS. Valid values are: \n"
               "\"chromeless\" -- to not use tabs or the accordion; \n"
               "\"tabs\" -- to use tabs only; \n"
               "\"accordion\" -- to use the accordion only; or \n"
               "\"tabs,accordion\" -- to use tabs and the accordion."),
        scope=Scope.settings,
        default=None,
    )
    default_tab = String(
        display_name=_("Default Tab"),
        help=_("Enter the tab that is selected in the XBlock. If not set, the Course tab is selected."),
        scope=Scope.settings,
        default=None,
    )
    source_file = String(
        display_name=_("LaTeX Source File Name"),
        help=_("Enter the source file name for LaTeX."),
        scope=Scope.settings,
        deprecated=True
    )
    visible_to_staff_only = Boolean(
        help=_("If true, can be seen only by course staff, regardless of start date."),
        default=False,
        scope=Scope.settings,
    )
    group_access = GroupAccessDict(
        help=_(
            "A dictionary that maps which groups can be shown this block. The keys "
            "are group configuration ids and the values are a list of group IDs. "
            "If there is no key for a group configuration or if the set of group IDs "
            "is empty then the block is considered visible to all. Note that this "
            "field is ignored if the block is visible_to_staff_only."
        ),
        default={},
        scope=Scope.settings,
    )

    @lazy
    def merged_group_access(self):
        """
        This computes access to a block's group_access rules in the context of its position
        within the courseware structure, in the form of a lazily-computed attribute.
        Each block's group_access rule is merged recursively with its parent's, guaranteeing
        that any rule in a parent block will be enforced on descendants, even if a descendant
        also defined its own access rules.  The return value is always a dict, with the same
        structure as that of the group_access field.

        When merging access rules results in a case where all groups are denied access in a
        user partition (which effectively denies access to that block for all students),
        the special value False will be returned for that user partition key.
        """
        parent = self.get_parent()
        if not parent:
            return self.group_access or {}

        merged_access = parent.merged_group_access.copy()
        if self.group_access is not None:
            for partition_id, group_ids in self.group_access.items():
                if group_ids:  # skip if the "local" group_access for this partition is None or empty.
                    if partition_id in merged_access:
                        if merged_access[partition_id] is False:
                            # special case - means somewhere up the hierarchy, merged access rules have eliminated
                            # all group_ids from this partition, so there's no possible intersection.
                            continue
                        # otherwise, if the parent defines group access rules for this partition,
                        # intersect with the local ones.
                        merged_access[partition_id] = list(
                            set(merged_access[partition_id]).intersection(group_ids)
                        ) or False
                    else:
                        # add the group access rules for this partition to the merged set of rules.
                        merged_access[partition_id] = group_ids
        return merged_access

    # Specified here so we can see what the value set at the course-level is.
    user_partitions = UserPartitionList(
        help=_("The list of group configurations for partitioning students in content experiments."),
        default=[],
        scope=Scope.settings
    )

    def _get_user_partition(self, user_partition_id):
        """
        Returns the user partition with the specified id. Note that this method can return
        an inactive user partition. Raises `NoSuchUserPartitionError` if the lookup fails.
        """
        for user_partition in self.runtime.service(self, 'partitions').course_partitions:
            if user_partition.id == user_partition_id:
                return user_partition

        raise NoSuchUserPartitionError("could not find a UserPartition with ID [{}]".format(user_partition_id))

    def _has_nonsensical_access_settings(self):
        """
        Checks if a block's group access settings do not make sense.

        By nonsensical access settings, we mean a component's access
        settings which contradict its parent's access in that they
        restrict access to the component to a group that already
        will not be able to see that content.
        Note:  This contradiction can occur when a component
        restricts access to the same partition but a different group
        than its parent, or when there is a parent access
        restriction but the component attempts to allow access to
        all learners.

        Returns:
            bool: True if the block's access settings contradict its
            parent's access settings.
        """
        parent = self.get_parent()
        if not parent:
            return False

        parent_group_access = parent.group_access
        component_group_access = self.group_access

        for user_partition_id, parent_group_ids in parent_group_access.iteritems():
            component_group_ids = component_group_access.get(user_partition_id)
            if component_group_ids:
                return parent_group_ids and not set(component_group_ids).issubset(set(parent_group_ids))
            else:
                return not component_group_access
        else:
            return False

    def is_unit(self):
        """
        Returns whether the xblock is a unit.

        Get_parent_unit() returns None if the current xblock either does not have a parent unit or is itself a unit.
        To make sure that get_parent_unit() isn't returning None because the xblock is an orphan, we check that the
        xblock has a parent.
        """
        return get_parent_unit(self) is None and self.get_parent()

    def validate(self):
        """
        Validates the state of this xblock instance.
        """
        _ = self.runtime.service(self, "i18n").ugettext
        validation = super(LmsBlockMixin, self).validate()
        has_invalid_user_partitions = False
        has_invalid_groups = False

        for user_partition_id, group_ids in self.group_access.iteritems():
            try:
                user_partition = self._get_user_partition(user_partition_id)
            except NoSuchUserPartitionError:
                has_invalid_user_partitions = True
            else:
                # Skip the validation check if the partition has been disabled
                if user_partition.active:
                    for group_id in group_ids:
                        try:
                            user_partition.get_group(group_id)
                        except NoSuchUserPartitionGroupError:
                            has_invalid_groups = True

        if has_invalid_user_partitions:
            validation.add(
                ValidationMessage(
                    ValidationMessage.ERROR,
                    INVALID_USER_PARTITION_VALIDATION
                )
            )

        if has_invalid_groups:
            validation.add(
                ValidationMessage(
                    ValidationMessage.ERROR,
                    INVALID_USER_PARTITION_GROUP_VALIDATION_UNIT if self.is_unit() else INVALID_USER_PARTITION_GROUP_VALIDATION_COMPONENT
                )
            )

        if self._has_nonsensical_access_settings():
            validation.add(
                ValidationMessage(
                    ValidationMessage.ERROR,
                    NONSENSICAL_ACCESS_RESTRICTION
                )
            )

        return validation

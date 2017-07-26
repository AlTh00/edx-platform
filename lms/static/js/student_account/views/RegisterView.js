(function(define) {
    'use strict';
    define([
        'jquery',
        'underscore',
        'gettext',
        'edx-ui-toolkit/js/utils/string-utils',
        'js/student_account/views/FormView',
        'text!templates/student_account/form_status.underscore'
    ],
        function(
            $, _, gettext,
            StringUtils,
            FormView,
            formStatusTpl
        ) {
            return FormView.extend({
                el: '#register-form',
                tpl: '#register-tpl',
                validationUrl: '/api/user/v1/validation/registration',
                events: {
                    'click .js-register': 'submitForm',
                    'click .login-provider': 'thirdPartyAuth',
                    'click input[required][type="checkbox"]': 'liveValidateHandler',
                    'blur input[required]': 'liveValidateHandler',
                    'focus input[required]': 'handleRequiredInputFocus',
                // Select boxes are unfortunately special cases,
                // because one "focuses" on the first item, not the input box.
                    'blur select[required]:first': 'liveValidateHandler',
                    'focus select[required]:first': 'handleRequiredInputFocus'
                },
                // Hold field names and timeout events for each
                liveValidationFields: {
                    name: null,
                    username: null,
                    password: null,
                    email: null,
                    confirm_email: null,
                    country: null,
                    honor_code: null
                },
                formType: 'register',
                formStatusTpl: formStatusTpl,
                authWarningJsHook: 'js-auth-warning',
                defaultFormErrorsTitle: gettext('We couldn\'t create your account.'),
                submitButton: '.js-register',
                positiveValidationIcon: 'fa-check',
                negativeValidationIcon: 'fa-exclamation',
                successfulValidationDisplaySeconds: 3,

                preRender: function(data) {
                    this.providers = data.thirdPartyAuth.providers || [];
                    this.hasSecondaryProviders = (
                        data.thirdPartyAuth.secondaryProviders && data.thirdPartyAuth.secondaryProviders.length
                    );
                    this.currentProvider = data.thirdPartyAuth.currentProvider || '';
                    this.errorMessage = data.thirdPartyAuth.errorMessage || '';
                    this.platformName = data.platformName;
                    this.autoSubmit = data.thirdPartyAuth.autoSubmitRegForm;
                    this.hideAuthWarnings = data.hideAuthWarnings;
                    this.autoRegisterWelcomeMessage = data.thirdPartyAuth.autoRegisterWelcomeMessage || '';

                    this.listenTo(this.model, 'sync', this.saveSuccess);
                    this.listenTo(this.model, 'validation', this.renderLiveValidations);
                },

                render: function(html) {
                    var fields = html || '',
                        formErrorsTitle = gettext('An error occurred.');

                    $(this.el).html(_.template(this.tpl)({
                    /* We pass the context object to the template so that
                     * we can perform variable interpolation using sprintf
                     */
                        context: {
                            fields: fields,
                            currentProvider: this.currentProvider,
                            providers: this.providers,
                            hasSecondaryProviders: this.hasSecondaryProviders,
                            platformName: this.platformName,
                            autoRegisterWelcomeMessage: this.autoRegisterWelcomeMessage
                        }
                    }));

                    this.postRender();

                    // Must be called after postRender, since postRender sets up $formFeedback.
                    if (this.errorMessage) {
                        this.renderErrors(formErrorsTitle, [this.errorMessage]);
                    } else if (this.currentProvider && !this.hideAuthWarnings) {
                        this.renderAuthWarning();
                    }

                    if (this.autoSubmit) {
                        $(this.el).hide();
                        $('#register-honor_code').prop('checked', true);
                        this.submitForm();
                    }

                    return this;
                },

                hideRequiredMessageExceptOnError: function($el) {
                    // We only handle blur if not in an error state.
                    if (!$el.hasClass('error')) {
                        this.hideRequiredMessage($el);
                    }
                },

                hideRequiredMessage: function($el) {
                    this.doOnInputLabel($el, function($label) {
                        $label.addClass('hidden');
                    });
                },

                doOnInputLabel: function($el, action) {
                    var $label = this.getRequiredTextLabel($el);
                    action($label);
                },

                handleRequiredInputFocus: function(event) {
                    var $el = $(event.currentTarget);
                    // Avoid rendering for required checkboxes.
                    if ($el.attr('type') !== 'checkbox') {
                        this.renderRequiredMessage($el);
                    }
                    if ($el.hasClass('error')) {
                        this.doOnInputLabel($el, function($label) {
                            $label.addClass('error');
                        });
                    }
                },

                renderRequiredMessage: function($el) {
                    this.doOnInputLabel($el, function($label) {
                        $label.removeClass('hidden').text(gettext('(required)'));
                    });
                },

                getRequiredTextLabel: function($el) {
                    return $('#' + $el.attr('id') + '-required-label');
                },

                renderLiveValidations: function($el, decisions) {
                    var $label = this.getLabel($el),
                        $requiredTextLabel = this.getRequiredTextLabel($el),
                        $icon = this.getIcon($el),
                        $errorTip = this.getErrorTip($el),
                        name = $el.attr('name'),
                        type = $el.attr('type'),
                        isCheckbox = type === 'checkbox',
                        hasError = decisions.validation_decisions[name] !== '',
                        error = isCheckbox ? '' : decisions.validation_decisions[name];

                    if (hasError) {
                        this.renderLiveValidationError($el, $label, $requiredTextLabel, $icon, $errorTip, error);
                    } else {
                        this.renderLiveValidationSuccess($el, $label, $requiredTextLabel, $icon, $errorTip);
                    }
                },

                getLabel: function($el) {
                    return this.$form.find('label[for=' + $el.attr('id') + ']');
                },

                getIcon: function($el) {
                    return $('#' + $el.attr('id') + '-validation-icon');
                },

                getErrorTip: function($el) {
                    return $('#' + $el.attr('id') + '-validation-error');
                },

                renderLiveValidationError: function($el, $label, $req, $icon, $tip, error) {
                    this.removeLiveValidationIndicators(
                        $el, $label, $req, $icon,
                        'success', this.positiveValidationIcon
                    );
                    this.addLiveValidationIndicators(
                        $el, $label, $req, $icon, $tip,
                        'error', this.negativeValidationIcon, error
                    );
                    this.renderRequiredMessage($el);
                },

                renderLiveValidationSuccess: function($el, $label, $req, $icon, $tip) {
                    var self = this,
                        name = $el.attr('name'),
                        validationFadeTime = this.successfulValidationDisplaySeconds * 1000;
                    this.removeLiveValidationIndicators(
                        $el, $label, $req, $icon,
                        'error', this.negativeValidationIcon
                    );
                    this.addLiveValidationIndicators(
                        $el, $label, $req, $icon, $tip,
                        'success', this.positiveValidationIcon, ''
                    );
                    this.hideRequiredMessage($el);

                    // Hide success indicators after some time.
                    if (this.liveValidationFields[name]) {
                        clearTimeout(this.liveValidationFields[name]);
                    }
                    this.liveValidationFields[name] = setTimeout(function() {
                        self.removeLiveValidationIndicators(
                            $el, $label, $req, $icon,
                            'success', self.positiveValidationIcon
                        );
                    }, validationFadeTime);
                },

                addLiveValidationIndicators: function($el, $label, $req, $icon, $tip, indicator, icon, msg) {
                    $el.addClass(indicator);
                    $label.addClass(indicator);
                    $req.addClass(indicator);
                    $icon.addClass(indicator + ' ' + icon);
                    $tip.text(msg);
                },

                removeLiveValidationIndicators: function($el, $label, $req, $icon, indicator, icon) {
                    $el.removeClass(indicator);
                    $label.removeClass(indicator);
                    $req.removeClass(indicator);
                    $icon.removeClass(indicator + ' ' + icon);
                },

                thirdPartyAuth: function(event) {
                    var providerUrl = $(event.currentTarget).data('provider-url') || '';

                    if (providerUrl) {
                        window.location.href = providerUrl;
                    }
                },

                saveSuccess: function() {
                    this.trigger('auth-complete');
                },

                saveError: function(error) {
                    $(this.el).show(); // Show in case the form was hidden for auto-submission
                    this.errors = _.flatten(
                        _.map(
                            // Something is passing this 'undefined'. Protect against this.
                            JSON.parse(error.responseText || '[]'),
                            function(errorList) {
                                return _.map(
                                    errorList,
                                    function(errorItem) {
                                        return StringUtils.interpolate('<li>{error}</li>', {
                                            error: errorItem.user_message
                                        });
                                    }
                                );
                            }
                        )
                    );
                    this.renderErrors(this.defaultFormErrorsTitle, this.errors);
                    this.toggleDisableButton(false);
                },

                postFormSubmission: function() {
                    if (_.compact(this.errors).length) {
                    // The form did not get submitted due to validation errors.
                        $(this.el).show(); // Show in case the form was hidden for auto-submission
                    }
                },

                renderAuthWarning: function() {
                    var msgPart1 = gettext('You\'ve successfully signed into %(currentProvider)s.'),
                        msgPart2 = gettext(
                            'We just need a little more information before you start learning with %(platformName)s.'
                        ),
                        fullMsg = _.sprintf(
                            msgPart1 + ' ' + msgPart2,
                            {currentProvider: this.currentProvider, platformName: this.platformName}
                        );

                    this.renderFormFeedback(this.formStatusTpl, {
                        jsHook: this.authWarningJsHook,
                        message: fullMsg
                    });
                },

                getFormData: function() {
                    var obj = FormView.prototype.getFormData.apply(this, arguments),
                        $form = this.$form,
                        $emailElement = $form.find('input[name=email]'),
                        $confirmEmail = $form.find('input[name=confirm_email]'),
                        elements = $form[0].elements,
                        $el,
                        key = '',
                        i;

                    for (i = 0; i < elements.length; i++) {
                        $el = $(elements[i]);
                        key = $el.attr('name') || false;

                        // Due to a bug in firefox, whitespaces in email type field are not removed.
                        // TODO: Remove this code once firefox bug is resolved.
                        if (key === 'email') {
                            $el.val($el.val().trim());
                        }

                        // Simulate live validation.
                        if (this.inValidationFields($el)) {
                            $el.blur();

                            // Special case: show required string for errors even if we're not focused.
                            if ($el.hasClass('error')) {
                                this.renderRequiredMessage($el);
                            }
                        }
                    }

                    if ($confirmEmail.length) {
                        if (!$confirmEmail.val() || $emailElement.val() !== $confirmEmail.val()) {
                            this.errors.push(StringUtils.interpolate('<li>{error}</li>', {
                                error: $confirmEmail.data('errormsg-required')
                            }));
                        }
                        obj.confirm_email = $confirmEmail.val();
                    }

                    return obj;
                },

                liveValidateHandler: function(event) {
                    var $el = $(event.currentTarget),
                        type = $el.attr('type');
                    if (this.inValidationFields($el)) {
                        if (type === 'checkbox') {
                            this.liveValidateCheckbox($el);
                        } else {
                            this.liveValidate($el);
                        }
                    }
                    // On blur, we do exactly as the function name says, no matter which input.
                    this.hideRequiredMessageExceptOnError($el);
                },

                liveValidate: function($el) {
                    var data = {},
                        field;
                    for (field in this.liveValidationFields) { // eslint-disable-line no-restricted-syntax
                        if (this.liveValidationFields.hasOwnProperty(field)) {
                            data[field] = $('#register-' + field).val();
                        }
                    }
                    FormView.prototype.liveValidate(
                        $el, this.validationUrl, 'json', data, 'POST', this.model
                    );
                },

                liveValidateCheckbox: function($checkbox) {
                    var validationDecisions = {validation_decisions: {}},
                        decisions = validationDecisions.validation_decisions,
                        name = $checkbox.attr('name'),
                        checked = $checkbox.is(':checked'),
                        error = $checkbox.data('errormsg-required');
                    decisions[name] = checked ? '' : error;
                    this.renderLiveValidations($checkbox, validationDecisions);
                }
            });
        });
}).call(this, define || RequireJS.define);

QUnit.module( 'dt.ui.ReplyWidget', QUnit.newMwEnvironment(), () => {
	const ReplyWidgetPlain = require( 'ext.discussionTools.ReplyWidget' ).ReplyWidgetPlain;

	function makeReplyWidget() {
		// The constructor of ReplyWidget needs these properties to construct, but are not used
		// yet in any of the tests
		const fakeCommentController = {
			getThreadItem: () => ( {
				range: {
					endContainer: document.createElement( 'div' )
				},
				getHeading: () => ( {
					getAuthorsBelow: () => []
				} )
			} )
		};

		return new ReplyWidgetPlain( fakeCommentController, {} );
	}

	QUnit.test( 'clearCaptcha clears the captcha widget and detaches the message', ( assert ) => {
		const replyWidget = makeReplyWidget();

		replyWidget.captchaWidget = 'should-be-cleared';

		replyWidget.clearCaptcha();

		assert.strictEqual(
			replyWidget.captchaWidget,
			undefined,
			'clearCaptcha should clear captchaWidget property'
		);
	} );

	QUnit.test( 'setSaveFailureCaptcha renders a captcha', function ( assert ) {
		const replyWidget = makeReplyWidget();
		const $captchaInputField = $( '<div>' ).append( '<input>' );

		mw.libs.confirmEdit = mw.libs.confirmEdit || {};
		const oldCaptchaWidget = mw.libs.confirmEdit.CaptchaWidget;

		const updateForCaptchaFailure = this.sandbox.stub();
		const renderCaptcha = this.sandbox.stub().resolves();
		const getInputField = this.sandbox.stub().returns( $captchaInputField[ 0 ] );
		let actualCaptchaWidgetConfig;
		mw.libs.confirmEdit.CaptchaWidget = function ( config ) {
			actualCaptchaWidgetConfig = config;
			this.updateForCaptchaFailure = updateForCaptchaFailure;
			this.renderCaptcha = renderCaptcha;
			this.getInputField = getInputField;
		};

		const onReplyClick = this.sandbox.stub( replyWidget, 'onReplyClick' );

		const captchaData = { type: 'simple' };
		replyWidget.setSaveFailureCaptcha( captchaData );

		mw.libs.confirmEdit.CaptchaWidget = oldCaptchaWidget;

		assert.strictEqual(
			actualCaptchaWidgetConfig.interfaceName,
			'discussiontools',
			'Captcha widget is created for the discussiontools interface'
		);
		assert.false(
			replyWidget.captchaMessage.isVisible(),
			'Captcha message is hidden before captcha rendering finishes'
		);
		assert.true(
			replyWidget.captchaMessage.$element.prev()[ 0 ] === replyWidget.$preview[ 0 ],
			'Captcha message is inserted after preview'
		);
		assert.strictEqual(
			replyWidget.captchaMessage.$element.find( actualCaptchaWidgetConfig.container ).length,
			1,
			'Captcha message contains the captcha widget container'
		);

		return renderCaptcha.firstCall.returnValue.then( () => {
			assert.true(
				updateForCaptchaFailure.calledOnceWithExactly( captchaData ),
				'Captcha widget receives failure data before rendering'
			);
			assert.true(
				renderCaptcha.calledOnce,
				'Captcha widget render is requested once'
			);
			assert.true(
				replyWidget.captchaMessage.isVisible(),
				'Captcha message is shown after captcha rendering finishes'
			);

			$captchaInputField.find( 'input' ).trigger( $.Event( 'keydown', { which: OO.ui.Keys.ENTER } ) );
			assert.true(
				onReplyClick.calledOnce,
				'Pressing Enter in captcha input triggers submit'
			);
		} );
	} );

	QUnit.test( 'setInitialCaptcha renders a captcha', function ( assert ) {
		const dtConfig = require( 'ext.discussionTools.init' ).config;
		this.sandbox.stub( dtConfig, 'hCaptchaRequiredForAllEdits' ).value( true );

		const replyWidget = makeReplyWidget();

		mw.libs.confirmEdit = mw.libs.confirmEdit || {};
		const oldCaptchaWidget = mw.libs.confirmEdit.CaptchaWidget;
		const oldCaptchaWidgetStatic = mw.libs.confirmEdit.CaptchaWidget.static;

		const renderCaptcha = this.sandbox.stub().resolves();
		const getInputField = this.sandbox.stub().returns( null );
		let actualCaptchaWidgetConfig;
		mw.libs.confirmEdit.CaptchaWidget = function ( config ) {
			actualCaptchaWidgetConfig = config;
			this.renderCaptcha = renderCaptcha;
			this.getInputField = getInputField;
		};
		mw.libs.confirmEdit.CaptchaWidget.static = {
			captchaNeededForEdit: () => 'hcaptcha'
		};

		replyWidget.setInitialCaptcha();

		mw.libs.confirmEdit.CaptchaWidget = oldCaptchaWidget;
		mw.libs.confirmEdit.CaptchaWidget.static = oldCaptchaWidgetStatic;

		assert.strictEqual(
			actualCaptchaWidgetConfig.interfaceName,
			'discussiontools',
			'Captcha widget is created for the discussiontools interface'
		);
		assert.strictEqual(
			actualCaptchaWidgetConfig.type,
			'hcaptcha',
			'Captcha widget uses the CAPTCHA type provided by captchaNeededForEdit'
		);
		assert.strictEqual(
			replyWidget.captchaMessage.$element.find( actualCaptchaWidgetConfig.container ).length,
			1,
			'Captcha message contains the captcha widget container'
		);

		return renderCaptcha.firstCall.returnValue.then( () => {
			assert.true(
				renderCaptcha.calledOnce,
				'Captcha widget render is requested once'
			);
		} );
	} );

	QUnit.test( 'setInitialCaptcha does nothing if CaptchaWidget not defined', ( assert ) => {
		const replyWidget = makeReplyWidget();

		mw.libs.confirmEdit = mw.libs.confirmEdit || {};
		const oldCaptchaLibrary = mw.libs.confirmEdit;
		mw.libs.confirmEdit = {};

		replyWidget.setInitialCaptcha();

		mw.libs.confirmEdit = oldCaptchaLibrary;

		assert.strictEqual(
			replyWidget.captchaWidget,
			undefined,
			'Captcha widget is not created if CaptchaWidget is not defined'
		);
	} );

	QUnit.test( 'setInitialCaptcha does nothing if CAPTCHA does not support initial render', ( assert ) => {
		const replyWidget = makeReplyWidget();

		mw.libs.confirmEdit = mw.libs.confirmEdit || {};
		const oldCaptchaWidgetStatic = mw.libs.confirmEdit.CaptchaWidget.static;

		mw.libs.confirmEdit.CaptchaWidget.static = {
			captchaNeededForEdit: () => 'simple'
		};

		replyWidget.setInitialCaptcha();

		mw.libs.confirmEdit.CaptchaWidget.static = oldCaptchaWidgetStatic;

		assert.strictEqual(
			replyWidget.captchaWidget,
			undefined,
			'Captcha widget is not created if the CAPTCHA type does not support initial render'
		);
	} );

	QUnit.test( 'setInitialCaptcha does nothing when hCaptchaRequiredForAllEdits is false', function ( assert ) {
		const dtConfig = require( 'ext.discussionTools.init' ).config;
		this.sandbox.stub( dtConfig, 'hCaptchaRequiredForAllEdits' ).value( false );

		const replyWidget = makeReplyWidget();

		mw.libs.confirmEdit = mw.libs.confirmEdit || {};
		const oldCaptchaWidget = mw.libs.confirmEdit.CaptchaWidget;

		mw.libs.confirmEdit.CaptchaWidget = function () {};
		mw.libs.confirmEdit.CaptchaWidget.static = {
			captchaNeededForEdit: () => 'hcaptcha'
		};

		replyWidget.setInitialCaptcha();

		mw.libs.confirmEdit.CaptchaWidget = oldCaptchaWidget;

		assert.strictEqual(
			replyWidget.captchaWidget,
			undefined,
			'Captcha widget is not created if hCaptcha is not required for all DT edits'
		);
	} );
} );

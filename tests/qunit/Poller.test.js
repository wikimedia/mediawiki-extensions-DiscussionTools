let documentHidden = false;

QUnit.module( 'ext.discussionTools.Poller', QUnit.newMwEnvironment( {
	beforeEach: function () {
		// Poller#updatePaused reads document.hidden. The tests run in a real tab, so they
		// must not depend on whether that tab has focus.
		documentHidden = false;
		Object.defineProperty( document, 'hidden', {
			configurable: true,
			get: () => documentHidden
		} );
	},
	afterEach: function () {
		delete document.hidden;
	}
} ), () => {
	const Poller = require( 'ext.discussionTools.init' ).Poller;

	// Poller's defaults, repeated here so the tests fail if the defaults change.
	const INTERVAL = 5000;
	const MAX_INTERVAL = 1000 * 60 * 60;
	const INACTIVITY_TIMEOUT = 1000 * 60 * 5;
	const HOUR = 1000 * 60 * 60;

	// The delays the poller schedules after each consecutive failure. The 17th failure
	// would need 82 minutes, which is over maxInterval, so the poller stops instead.
	const BACKOFF_DELAYS = [
		7500, 11250, 16875, 25313, 37969, 56953, 85430, 128145,
		192217, 288325, 432488, 648732, 973098, 1459646, 2189469, 3284204
	];

	// Minutes of continuously active use needed to reach each consecutive failure.
	// This is the number QA measures: how long the run takes to get to failure N.
	const ELAPSED_MINUTES = [ 0, 0, 0, 1, 1, 2, 3, 4, 6, 9, 14, 21, 32, 48, 73, 109, 164 ];

	function getElapsedMinutes( requestTimes ) {
		return requestTimes.map( ( time ) => Math.round( ( time - requestTimes[ 0 ] ) / 60000 ) );
	}

	/**
	 * Create a Poller with a controllable request, and record when each request is made.
	 *
	 * @param {Function} respond Called with ( request, requestNumber ) to settle each request
	 * @param {Object} [config] Poller config
	 * @return {Object} Object with `poller` and `requestTimes` properties
	 */
	function createPoller( respond, config ) {
		const requestTimes = [];
		const poller = new Poller(
			() => {
				requestTimes.push( Date.now() );
				const request = $.Deferred();
				// mw.Api rejects aborted requests with this signature
				request.abort = () => request.reject( 'http', { textStatus: 'abort' } );
				respond( request, requestTimes.length );
				return request;
			},
			() => {},
			config
		);
		return { poller, requestTimes };
	}

	/**
	 * Keep the poller active, as a user writing a reply would.
	 *
	 * @param {Poller} poller
	 * @return {number} Interval ID, to pass to clearInterval
	 */
	function stayActive( poller ) {
		return setInterval( () => poller.onUserActivity(), INACTIVITY_TIMEOUT / 2 );
	}

	/**
	 * Show or hide the tab, and tell the poller about it.
	 *
	 * @param {boolean} hidden
	 */
	function setHidden( hidden ) {
		documentHidden = hidden;
		$( document ).trigger( 'visibilitychange' );
	}

	/**
	 * The delays the poller passed to Poller#schedule.
	 *
	 * Gaps between requests are not the same thing: they also contain the promise
	 * plumbing, and they are empty while the poller is paused.
	 *
	 * @param {Object} scheduleSpy Sinon spy on Poller#schedule
	 * @return {number[]}
	 */
	function getScheduledDelays( scheduleSpy ) {
		return scheduleSpy.args.map( ( args ) => Math.round( args[ 0 ] ) );
	}

	const failRequest = ( request ) => request.reject( 'error', {} );

	QUnit.test( 'polls at the base interval while requests succeed', function ( assert ) {
		const clock = this.sandbox.useFakeTimers();
		const { poller, requestTimes } = createPoller( ( request ) => request.resolve( {} ) );
		const schedule = this.sandbox.spy( poller, 'schedule' );

		poller.start();
		const activity = stayActive( poller );
		clock.tick( INTERVAL * 10 );
		clearInterval( activity );
		poller.stop();

		assert.strictEqual( requestTimes.length, 10, 'ten requests were made' );
		assert.deepEqual(
			getScheduledDelays( schedule ),
			new Array( schedule.callCount ).fill( INTERVAL ),
			'every scheduled delay is the base interval'
		);
	} );

	QUnit.test( 'backs off and stops after 17 consecutive failures', function ( assert ) {
		const clock = this.sandbox.useFakeTimers();
		const { poller, requestTimes } = createPoller( failRequest );
		const schedule = this.sandbox.spy( poller, 'schedule' );

		poller.start();
		const activity = stayActive( poller );
		// Long enough for the whole chain, plus a margin to prove it has stopped
		clock.tick( HOUR * 12 );
		clearInterval( activity );

		assert.strictEqual( requestTimes.length, 17, 'polling stops after 17 failures' );
		assert.deepEqual(
			getScheduledDelays( schedule ),
			BACKOFF_DELAYS,
			'each failure multiplies the delay by 1.5'
		);
		assert.deepEqual(
			getElapsedMinutes( requestTimes ),
			ELAPSED_MINUTES,
			'an active user reaches the 14th failure at 48 minutes and the 17th at 2h44m'
		);
		poller.stop();
	} );

	QUnit.test( 'never schedules a delay longer than maxInterval', function ( assert ) {
		const clock = this.sandbox.useFakeTimers();
		const { poller } = createPoller( failRequest );
		const schedule = this.sandbox.spy( poller, 'schedule' );

		poller.start();
		const activity = stayActive( poller );
		clock.tick( HOUR * 12 );
		clearInterval( activity );

		const longestDelay = Math.max( ...getScheduledDelays( schedule ) );
		assert.true( longestDelay < MAX_INTERVAL, 'the longest scheduled delay is under maxInterval' );
		assert.strictEqual(
			Math.round( longestDelay / 60000 ),
			55,
			'the longest scheduled delay is 54.7 minutes'
		);
		poller.stop();
	} );

	QUnit.test( 'inactivity stretches the gap between requests past maxInterval', function ( assert ) {
		const clock = this.sandbox.useFakeTimers();
		const { poller, requestTimes } = createPoller( failRequest );

		poller.start();
		// Back off during an hour of active use, then walk away
		const activity = stayActive( poller );
		clock.tick( HOUR );
		clearInterval( activity );
		clock.tick( INACTIVITY_TIMEOUT + 1 );
		assert.true( poller.paused, 'the poller pauses after the inactivity timeout' );

		const requestsBeforeIdle = requestTimes.length;
		const lastRequestBeforeIdle = requestTimes[ requestTimes.length - 1 ];

		// Leave the reply widget open overnight
		clock.tick( HOUR * 11 );
		assert.strictEqual(
			requestTimes.length,
			requestsBeforeIdle,
			'no requests are made while paused'
		);

		// Come back to the page
		poller.onUserActivity();
		assert.strictEqual(
			requestTimes.length,
			requestsBeforeIdle + 1,
			'the skipped poll runs at once, without waiting for the next interval'
		);
		assert.true(
			requestTimes[ requestsBeforeIdle ] - lastRequestBeforeIdle > HOUR * 11,
			'the gap between two requests is still over 11 hours, because nothing polls while away'
		);
		poller.stop();
	} );

	QUnit.test( 'a hidden tab pauses polling and holds the backoff', function ( assert ) {
		const clock = this.sandbox.useFakeTimers();
		const { poller, requestTimes } = createPoller( failRequest );

		poller.start();
		const activity = stayActive( poller );
		clock.tick( HOUR );
		setHidden( true );
		const requestsBeforeHidden = requestTimes.length;
		const schedule = this.sandbox.spy( poller, 'schedule' );

		clock.tick( HOUR * 11 );
		assert.strictEqual(
			requestTimes.length,
			requestsBeforeHidden,
			'no requests are made while the tab is hidden'
		);
		assert.true( schedule.callCount > 1, 'the poller keeps waking up while hidden' );
		assert.deepEqual(
			getScheduledDelays( schedule ),
			new Array( schedule.callCount ).fill( getScheduledDelays( schedule )[ 0 ] ),
			'each paused wake-up re-arms the same delay, so the backoff is held'
		);

		const delayWhileHidden = getScheduledDelays( schedule ).pop();
		setHidden( false );
		assert.strictEqual(
			requestTimes.length,
			requestsBeforeHidden + 1,
			'showing the tab polls at once'
		);
		clock.tick( 1 );
		assert.strictEqual(
			getScheduledDelays( schedule ).pop(),
			Math.round( delayWhileHidden * 1.5 ),
			'the backoff is kept, so a failing API is not polled at the base interval'
		);
		clearInterval( activity );
		poller.stop();
	} );

	QUnit.test( 'an idle user takes far longer to reach the same failure count', function ( assert ) {
		const clock = this.sandbox.useFakeTimers();
		const { poller, requestTimes } = createPoller( failRequest );
		const targetFailures = 14;

		poller.start();
		// Someone who leaves the reply widget open overnight and touches the page
		// for ten minutes in every two hours
		for ( let cycle = 0; cycle < 24 && requestTimes.length < targetFailures; cycle++ ) {
			const activity = stayActive( poller );
			clock.tick( 1000 * 60 * 10 );
			clearInterval( activity );
			clock.tick( HOUR * 2 - 1000 * 60 * 10 );
		}

		assert.strictEqual( requestTimes.length, targetFailures, 'the 14th failure is reached' );
		const elapsedMinutes = Math.round(
			( requestTimes[ targetFailures - 1 ] - requestTimes[ 0 ] ) / 60000
		);
		assert.true(
			elapsedMinutes > 180,
			'it still takes over 3 hours (' + elapsedMinutes + ' minutes), against the ' +
				ELAPSED_MINUTES[ targetFailures - 1 ] + ' minutes an active user needs, ' +
				'because polls only happen while the user is there'
		);
		poller.stop();
	} );

	QUnit.test( 'failures do not accumulate while paused, so the chain never stops', function ( assert ) {
		const clock = this.sandbox.useFakeTimers();
		const { poller, requestTimes } = createPoller( failRequest );

		poller.start();
		const activity = stayActive( poller );
		clock.tick( HOUR );
		clearInterval( activity );
		const failuresBeforeIdle = requestTimes.length;

		// Four times as long as the chain needs to reach its 17th failure
		clock.tick( HOUR * 11 );

		assert.strictEqual( requestTimes.length, failuresBeforeIdle, 'no further failures' );
		assert.true( failuresBeforeIdle < 17, 'the failure count is short of the stop threshold' );
		assert.true( poller.started, 'the poller is still running' );
		poller.stop();
	} );

	QUnit.test( 'stalling requests adds the API timeout to every cycle', function ( assert ) {
		const clock = this.sandbox.useFakeTimers();
		// Network tools can stall a request instead of failing it. mw.Api gives up after
		// 30 seconds, and jQuery reports that as a timeout, which is not an abort.
		const API_TIMEOUT = 30000;
		const { poller, requestTimes } = createPoller( ( request ) => {
			setTimeout( () => request.reject( 'http', { textStatus: 'timeout' } ), API_TIMEOUT );
		} );

		poller.start();
		const activity = stayActive( poller );
		clock.tick( HOUR * 12 );
		clearInterval( activity );

		assert.strictEqual( requestTimes.length, 17, 'the backoff still stops after 17 failures' );
		const elapsedMinutes = Math.round( ( requestTimes[ 16 ] - requestTimes[ 0 ] ) / 60000 );
		assert.strictEqual(
			elapsedMinutes - ELAPSED_MINUTES[ 16 ],
			8,
			'waiting for 16 timeouts adds 8 minutes, not hours'
		);
		poller.stop();
	} );

	QUnit.test( 'reactivating does not start a second request while one is in flight', function ( assert ) {
		const clock = this.sandbox.useFakeTimers();
		// A request that never settles, as when network tools stall it indefinitely
		const { poller, requestTimes } = createPoller( () => {} );

		poller.start();
		assert.strictEqual( requestTimes.length, 1, 'one request is in flight' );

		clock.tick( INACTIVITY_TIMEOUT + 1 );
		assert.true( poller.paused, 'the poller pauses while the request is in flight' );
		poller.onUserActivity();
		clock.tick( HOUR );

		assert.strictEqual( requestTimes.length, 1, 'reactivating adds no second request' );
		poller.stop();
	} );

	QUnit.test( 'a restart does not run a poll skipped before the stop', function ( assert ) {
		const clock = this.sandbox.useFakeTimers();
		const { poller, requestTimes } = createPoller( failRequest );

		// CommentController stops the poller to save, and starts it again if the save fails
		poller.start();
		clock.tick( INACTIVITY_TIMEOUT * 2 );
		assert.true( poller.paused, 'the poller is paused with a skipped poll pending' );
		poller.stop();

		const requestsBeforeRestart = requestTimes.length;
		poller.start();
		assert.strictEqual(
			requestTimes.length,
			requestsBeforeRestart + 1,
			'the restart makes one request, not one for the restart and one for the skipped poll'
		);
		poller.stop();
	} );

	QUnit.test( 'an externally aborted request stops polling permanently', function ( assert ) {
		const clock = this.sandbox.useFakeTimers();
		// The browser cancels an in-flight request, e.g. when the machine suspends
		const { poller, requestTimes } = createPoller( ( request, requestNumber ) => {
			if ( requestNumber === 3 ) {
				request.reject( 'http', { textStatus: 'abort' } );
			} else {
				request.resolve( {} );
			}
		} );

		poller.start();
		const activity = stayActive( poller );
		clock.tick( HOUR );
		clearInterval( activity );

		assert.strictEqual( requestTimes.length, 3, 'polling stops at the aborted request' );
		assert.true( poller.started, 'but the poller still reports itself as started' );
		poller.stop();
	} );

	QUnit.test( 'user activity does not reset the backoff', function ( assert ) {
		const clock = this.sandbox.useFakeTimers();
		const { poller, requestTimes } = createPoller( failRequest );
		const schedule = this.sandbox.spy( poller, 'schedule' );

		poller.start();
		const activity = stayActive( poller );
		// Six requests fail, so the seventh is BACKOFF_DELAYS[ 5 ] after the sixth
		clock.tick( 150000 );
		assert.strictEqual( requestTimes.length, 6, 'six requests have failed' );
		assert.strictEqual(
			getScheduledDelays( schedule ).pop(),
			BACKOFF_DELAYS[ 5 ],
			'the pending delay is the backed-off one'
		);

		const scheduleCallsBeforeActivity = schedule.callCount;
		poller.onUserActivity();
		clock.tick( INTERVAL );
		assert.strictEqual( schedule.callCount, scheduleCallsBeforeActivity, 'activity reschedules nothing' );
		assert.strictEqual(
			requestTimes.length,
			6,
			'activity does not bring the next poll forward to the base interval'
		);

		clock.tick( BACKOFF_DELAYS[ 5 ] );
		assert.strictEqual( requestTimes.length, 7, 'the next poll waits the full backed-off delay' );
		clearInterval( activity );
		poller.stop();
	} );

	QUnit.test( 'document events feed the inactivity timer', function ( assert ) {
		const clock = this.sandbox.useFakeTimers();
		const { poller } = createPoller( failRequest );

		poller.start();
		clock.tick( INACTIVITY_TIMEOUT + 1 );
		assert.true( poller.paused, 'the poller pauses without input' );

		$( document ).trigger( 'mousedown' );
		// OO.ui.throttle defers the handler
		clock.tick( 1000 );
		assert.false( poller.paused, 'input resumes the poller' );

		poller.stop();
	} );
} );

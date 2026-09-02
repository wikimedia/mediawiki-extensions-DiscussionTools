/**
 * Generic polling helper with exponential backoff and inactivity pauses.
 *
 * @class
 * @param {Function} getApiRequest Function returning an abortable jQuery promise
 * @param {Function} onSuccess Function to handle successful responses from the API request
 * @param {Object} [config]
 * @param {number} [config.interval=5000] Interval between polls, in milliseconds
 * @param {number} [config.maxInterval=1 hour] Maximum interval between polls, in milliseconds
 * @param {number} [config.inactivityTimeout=5 minutes] Time after which we become inactive, in milliseconds.
 */
function Poller( getApiRequest, onSuccess, config ) {
	config = config || {};

	this.getApiRequest = getApiRequest;
	this.onSuccess = onSuccess;

	this.interval = config.interval || 5000;
	this.maxInterval = config.maxInterval || 1000 * 60 * 60;
	this.inactivityTimeout = config.inactivityTimeout || 1000 * 60 * 5;

	this.apiRequest = null;
	this.started = false;
	this.paused = false;
	this.isInactive = false;
	this.skippedPollInterval = null;

	this.pollTimeoutId = null;
	this.inactivityTimeoutId = null;
	this.onVisibilityChangeHandler = this.onVisibilityChange.bind( this );
	this.onUserActivityHandler = OO.ui.throttle( this.onUserActivity.bind( this ), 1000 );
}

/**
 * Start polling.
 */
Poller.prototype.start = function () {
	if ( this.started ) {
		return;
	}
	this.started = true;
	$( document )
		.on( 'mousemove mousedown keydown touchstart', this.onUserActivityHandler )
		.on( 'visibilitychange', this.onVisibilityChangeHandler );
	this.onUserActivity();
	this.poll( this.interval );
};

/**
 * Stop polling and abort any in-flight request.
 */
Poller.prototype.stop = function () {
	this.started = false;
	$( document )
		.off( 'mousemove mousedown keydown touchstart', this.onUserActivityHandler )
		.off( 'visibilitychange', this.onVisibilityChangeHandler );

	this.clearInactivityTimer();
	this.clearPollTimer();
	this.skippedPollInterval = null;

	if ( this.apiRequest ) {
		this.apiRequest.abort();
		this.apiRequest = null;
	}
};

/**
 * Update the paused state based on document visibility and inactivity.
 */
Poller.prototype.updatePaused = function () {
	const wasPaused = this.paused;
	this.paused = document.hidden || this.isInactive;

	// Do a poll that a pause skipped as soon as the user comes back. If we waited for
	// the next scheduled poll, the user could miss new comments for a full interval,
	// which is up to an hour after repeated failures.
	if ( wasPaused && !this.paused && this.skippedPollInterval !== null ) {
		this.poll( this.skippedPollInterval );
	}
};

/**
 * Handle visibility change events (e.g. tab losing focus).
 */
Poller.prototype.onVisibilityChange = function () {
	// Switching back to this tab is user activity.
	if ( !document.hidden ) {
		this.onUserActivity();
	}
	this.updatePaused();
};

/**
 * Clear the inactivity timer, if running.
 */
Poller.prototype.clearInactivityTimer = function () {
	if ( this.inactivityTimeoutId ) {
		clearTimeout( this.inactivityTimeoutId );
		this.inactivityTimeoutId = null;
	}
};

/**
 * Clear the poll timer, if running.
 */
Poller.prototype.clearPollTimer = function () {
	if ( this.pollTimeoutId ) {
		clearTimeout( this.pollTimeoutId );
		this.pollTimeoutId = null;
	}
};

/**
 * Reset and start the inactivity timer.
 */
Poller.prototype.resetInactivityTimer = function () {
	this.clearInactivityTimer();
	this.inactivityTimeoutId = setTimeout( this.onUserInactivity.bind( this ), this.inactivityTimeout );
};

/**
 * Handle user activity events (e.g. mouse movement, key presses).
 */
Poller.prototype.onUserActivity = function () {
	if ( !this.started ) {
		// The throttled handler can fire after stop() has unbound it
		return;
	}
	this.isInactive = false;
	this.updatePaused();
	this.resetInactivityTimer();
};

/**
 * Handle user inactivity (no keyboard/mouse for a fixed amount of time)
 */
Poller.prototype.onUserInactivity = function () {
	this.clearInactivityTimer();
	this.isInactive = true;
	this.updatePaused();
};

/**
 * Schedule the next poll after a given interval.
 *
 * @param {number} nextInterval Time until the next poll, in milliseconds
 */
Poller.prototype.schedule = function ( nextInterval ) {
	if ( !this.started ) {
		return;
	}
	this.clearPollTimer();
	this.pollTimeoutId = setTimeout( this.poll.bind( this, nextInterval ), nextInterval );
};

/**
 * Perform a poll: issue the API request and handle success/failure.
 *
 * @param {number} nextInterval Time until the next poll, in milliseconds.
 */
Poller.prototype.poll = function ( nextInterval ) {
	this.clearPollTimer();

	if ( !this.started ) {
		return;
	}

	if ( this.paused ) {
		this.skippedPollInterval = nextInterval;
		this.schedule( nextInterval );
		return;
	}

	this.skippedPollInterval = null;

	let aborted = false;
	this.apiRequest = this.getApiRequest();

	this.apiRequest.then( ( ...args ) => {
		this.onSuccess( ...args );
		nextInterval = this.interval;
	}, ( code, data ) => {
		if ( code === 'http' && data && data.textStatus === 'abort' ) {
			aborted = true;
		} else {
			// Wait longer next time in case of error
			nextInterval = nextInterval * 1.5;
		}
	} ).always( () => {
		this.apiRequest = null;

		if ( !this.started || aborted ) {
			return;
		}

		// Stop polling after too many errors
		if ( nextInterval < this.maxInterval ) {
			this.schedule( nextInterval );
		}
	} );
};

module.exports = Poller;

/*
 Copyright (c) 2010 uxebu Consulting Ltd. & Co. KG
 Copyright (c) 2010 David Aurelio
 All rights reserved.

 Redistribution and use in source and binary forms, with or without
 modification, are permitted provided that the following conditions are met:

 1. Redistributions of source code must retain the above copyright
    notice, this list of conditions and the following disclaimer.
 2. Redistributions in binary form must reproduce the above copyright
    notice, this list of conditions and the following disclaimer in the
    documentation and/or other materials provided with the distribution.

 THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
 AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
 IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
 ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
 LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
 POSSIBILITY OF SUCH DAMAGE.
*/

/**
 * @static
 * @type {Object} Global configuration options for TouchScroll.
 */
TouchScroll.config = {
    /** @type {Number} The minimum move distance to trigger scrolling (in pixels). */
    threshold: 5,

    /** @type {Number} The minimum scroll handle size. */
    scrollHandleMinSize: 25,

    /** @type {Object} Flicking detection and configuration. */
    flicking: {
        /**
         * Maximum duration between last touchmove and the touchend event
         * to trigger flicking.
         *
         * @type {Number}
         */
        triggerThreshold: 150,

        /**
         * Friction factor (per milisecond). This factor is used to
         * precalculate the flick length. Lower numbers make flicks
         * decelerate earlier.
         *
         * @type {Number}
         */
        friction: 0.998,

        /**
         * Minimum speed needed before the animation stop (px/ms) This value is
         * used to precalculate the flick length. Larger numbers lead to
         * shorter flicking lengths and durations.
         *
         * @type {Number}
         */
        minSpeed: 0.15,

        /**
         * The timing function for flicking animinations (control points
         * for a cubic bezier curve).
         *
         * @type {Number[]}
         */
        timingFunc: [0, 0.3, 0.6, 1]
    },

    /** @type {Object} Bouncing configuration */
    elasticity: {
        /** @type {Number} Factor for the bounce length while dragging. */
        factorDrag: 0.5,

        /** @type {Number} Factor for the bounce length while flicking. */
        factorFlick: 0.2,

        /** @type {Number} Maximum bounce (in px) when flicking. */
        max: 100
    },

    /** @type {Object} Snap back configuration. */
    snapBack: {
        /**
         * The timing function for snap back animations (control points for
         * a cubic bezier curve) when bouncing out before, the first
         * control point is overwritten to achieve a smooth transition
         * between bounce and snapback.
         *
         * @type {Number[]}
         */
        timingFunc: [0.4, 0, 1, 1],

        /** @type {Number} Default snap back time. */
        defaultTime: 400,

        /**
         * Whether the snap back effect always uses the default time or
         * uses the bounce out time.
         *
         * @type {Boolean}
         */
        alwaysDefaultTime: true
    }
};

//
//	FEATURE DETECTION
//
/**
 * @type {Boolean} Whether touch events are supported by the user agent.
 * @private
 */
TouchScroll._hasTouchSupport = (function(){
    if ("createTouch" in document) { // True on the iPhone
        return true;
    }
    try {
        var event = document.createEvent("TouchEvent"); // Should throw an error if not supported
        return !!event.initTouchEvent; // Check for existance of initialization method
    } catch(error) {
        return false;
    }
}());

/**
 * Whether WebKitCSSMatrix is supported properly by the user agent.
 *
 * In some older versions of Android, WebKitCSSMatrix is broken and does
 * not parse a "matrix" directive properly.
 *
 * @type {Boolean}
 * @private
 */
TouchScroll._parsesMatrixCorrectly = (function(){
    var m = new WebKitCSSMatrix("matrix(1, 0, 0, 1, -20, -30)");
    return m.e == -20 && m.f == -30;
}());

/**
 * Whether we are on Android.
 *
 * @type {Number} Android version number or `null`.
 * @private
 */
TouchScroll._android = (function(){
    var match = navigator.userAgent.match(/Android\s+(\d+(?:\.\d+)?)/);
    return match && parseFloat(match[1]);
}());

/**
 * Contains the name of the events to listen for.
 *
 * Depends on touch support.
 *
 * @type {Object}
 * @private
 */
TouchScroll._eventNames = {
    /** @type {String} The name of the start event. */
    start: "touchstart",

    /** @type {String} The name of the move event. */
    move: "touchmove",

    /** @type {String} The name of the end event. */
    end: "touchend",

    /** @type {String} The name of the cancel event. */
    cancel: "touchcancel"
};

if (!TouchScroll._hasTouchSupport) { // overwrite event names
    TouchScroll._eventNames = {
        start: "mousedown",
        move: "mousemove",
        end: "mouseup",
        cancel: "touchcancel" // unnecessary here
    };
}

/**
 * @private
 * @type {CSSStyleSheet}
 */
TouchScroll._styleSheet = (function() {
    var doc = document;
    var parent = doc.querySelector("head") || doc.documentElement;
    var styleNode = document.createElement("style");
    parent.insertBefore(style, parent.firstChild);

    for (var i = 0, sheet; sheet = doc.styleSheets[i]; i++) {
        if (styleNode == sheet.ownerNode) {
            return sheet; // return the newly created stylesheet
        }
    }

    return doc.styleSheets[0]; // return a random stylesheet
}());

[
    ".touchScroll { position: relative; }",
    ".tsBars { pointer-events: none; opacity: 0; -webkit-transition: opacity 250ms; }",
    ".tsInner { float: left; min-width: 100%; -webkit-box-sizing: border-box; }",
    ".tsBar { display: none; }",
    ".tsBar.active { display: block; }"
].forEach(function(rule, i) { this.insertRule(rule, i); }, TouchScroll._styleSheet);

/**
 * @private
 * @param {HTMLElement} node
 * @returns {WebKitCSSMatrix} A matrix representing the current css transform of a node.
 */
TouchScroll._getNodeOffset = (function() {
    if (TouchScroll._parsesMatrixCorrectly) {
        return function _getNodeOffset(node) {
            var computedStyle = window.getComputedStyle(node);
            return new WebKitCSSMatrix(computedStyle.webkitTransform);
        };
    }

    var reMatrix = /matrix\(\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*,\s*-?\d+(?:\.\d+)?\s*\,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/;
    return function _getNodeOffset(node) {
        var matrix = new WebKitCSSMatrix();

        var computedStyle = window.getComputedStyle(node);
        var match = reMatrix.exec(computedStyle.webkitTransform);
        if (match) {
            matrix.e = match[1];
            matrix.f = match[2];
        }

        return matrix;
    }
}());

/**
 * @private
 * @param {TouchEvent|MouseEvent} event
 * @returns {WebKitCSSMatrix} A matrix representing the page offset of an event.
 */
TouchScroll._getEventOffset = function _getEventOffset(event) {
    if(event.touches && event.touches.length){
        event = event.touches[0];
    }

    var matrix = new WebKitCSSMatrix();
    matrix.e = event.pageX;
    matrix.f = event.pageY;

    return matrix;
};

/**
 * @private
 * @param {CSSStyleDeclaration} style
 * @param {WebKitCSSNatrix} matrix
 */
TouchScroll._setStyleOffset = function _setStyleOffset(style, matrix){
    style.webkitTransform = "translate(" + matrix.e + "px, " + matrix.f + "px)";
}

/**
 * @private
 * @type {String} HTML for TouchScroll instances.
 */
TouchScroll._scrollerTemplate = '<div><div class="tsInner"></div></div>';

/**
 * @private
 * @type {String} HTML for scrollbars. Used on instances with scrollbars.
 */
TouchScroll._scrollbarTemplate = [
    '<div class="tsBars">',
        '<div class="tsBar tsBarE">',
            '<div class="tsBar1"></div>',
            '<div class="tsBar2"></div>',
            '<div class="tsBar3"></div>',
        '</div>',
        '<div class="tsBar tsBarF">',
            '<div class="tsBar1"></div>',
            '<div class="tsBar2"></div>',
            '<div class="tsBar3"></div>',
        '</div>',
    '</div>'
].join("\n");

/**
 * @class
 * @param {HTMLElement} scrollElement The HTML element to make scrollable.
 * @param {Objects} [options] An expando for options. Supported options are:#
 *                            - elastic {Boolean}, defaults to `false`
 *                            - scrollbars {Boolean}, defaults to `true`
 */
function TouchScroll(scrollElement, options) {
    options = options || {};

    /** @type {Boolean} Whether the scroller bounces across its bounds. */
    this.elastic = !!options.elastic;

    /** @type {Boolean} Whether to build and use scrollbars. */
    var useScrollbars = options.scrollbars == null ? true : !!options.scrollbars;

    /** @type {Object} Holds scrollbar related metrics. */
    this._barMetrics = {
        /** @type {Object} Stores the offset height of the scrollbar "tracks". */
        availLength: {e: 0, f: 0}, //TODO: Check if necessary!
        /** @type {Number} Stores the size of the bar ends in pixels (assuming all have the same size). */
        endSize: 0,
        /** @type {Object} Stores the maximum offset for each scroll indicator. */
        maxOffsets: {e: 0, f: 0},
        /** @type {Object} Stores the ratio of scroll layer and scroll indicator offsets. */
        offsetRatios: {e: 0, f:0},
        /** @type {Object} Stores the calculated sizes of the scroll indicators. */
        sizes: {e: 0, f: 0}
    };

    /** @type {Object} Holds references to the DOM nodes used by the scroller. */
    this._dom = {
        /** @type {HTMLElement} A reference to the outer/main DOM node. */
        outer: scrollElement
    }

    /** @type {Object} Holds references to animation keyframes */
    this._animations = {
        scrollers: {
            e: this._createKeyframes(),
            f: this._createKeyframes()
        },
        bars: (useScrollbars ? {
            e: this._createKeyframes(),
            f: this._createKeyframes()
        } : null)
    };

    /** @type {Object} Stores whether each axis is scrolling. */
    this._isScrolling = {e: false, f: false, general: false};

    /** @type {Event[]} The last two tracked events .*/
    this._lastEvents = [];

    /** @type {Object} Stores the maximum scroll offset for each axis. */
    this._maxOffsets = {e: 0, f: 0};

    /** @type {Object} Stores the relevant metrics of the last call to {@link setupScroller}. */
    this._metrics = {
        offsetWidth: -1,
        offsetHeight: -1,
        scrollWidth: -1,
        scrollHeight: -1
    };

    /** @type {Boolean} Whether the scroll threshold has been exceeded. */
    this._scrollBegan = false;

    /** @type {WebKitCSSMatrix} The current scroll offset. Not valid while flicking. */
    this._scrollOffset = new WebKitCSSMatrix();

    this._initDom(useScrollbars);
}

TouchScroll.prototype = {
    config: TouchScroll.config,

    /**
     * @private
     * @static
     * @type {Object} Mapping from event types to handler names.
     */
    _handlerNames: {
        touchstart: "onTouchStart",
        mousedown: "onTouchStart",
        touchmove: "onTouchMove",
        mousemove: "onTouchMove",
        touchend: "onTouchEnd",
        mouseup: "onTouchEnd",
        touchcancel: "onTouchEnd"
    },

    /**
     * @private
     * @static
     * @type {Number} The number of created keyframes rules.
     */
    _numKeyframeRules: 0,

    _styleSheet: TouchScroll._styleSheet,

    /**
     * Centers the scroller.
     *
     * @returns {TouchScroll} Returns the TouchScroll instance.
     */
    center: function center() {
        return this;
    },

    /**
     * Centers the scroller at given coordinates.
     *
     * @param {Number} left The horizontal offset.
     * @param {Number} top The vertical offset.
     * @returns {TouchScroll} Returns the TouchScroll instance.
     */
    centerAt: function centerAt(left, top) {
        return this;
    },

    /**
     * DOM Level 2 event handler method.
     *
     * @private
     * @param {Event} event.
     */
    handleEvent: function handleEvent(event) {
        var handlerName = this._handlerNames[event.type];
        if(handlerName){
            this[handlerName](event);
        }
    },
    onTouchStart: function onTouchStart() {},
    onTouchMove: function onTouchMove() {},
    onTouchEnd: function onTouchEnd() {},
    scrollTo: function scrollTo() {},

    /**
     * Sets up the scroller according to its metrics.
     */
    setupScroller: function setupScroller(force) {
        var dom = this._dom;
        var scrollerElement = dom.outer;

        var offsetWidth = scrollerElement.offsetWidth;
        var offsetHeight = scrollerElement.offsetHeight;
        var scrollWidth = scrollerElement.scrollWidth;
        var scrollHeight = scrollerElement.scrollHeight;
        var m = this._metrics;

        // Check whether we really need to refresh ... if not, leave here.
        if (!force &&
            offsetWidth == m.offsetWidth && offsetHeight == m.offsetHeight &&
            scrollWidth == m.scrollWidth && scrollHeight == m.scrollHeight
        ) {
                return;
        }

        m.offsetWidth = offsetWidth;
        m.offsetHeight = offsetHeight;
        m.scrollWidth = scrollWidth;
        m.scrollHeight = scrollHeight;

        // instance properties
        var maxOffsets = this._maxOffsets = {
            e: Math.max(scrollWidth - offsetWidth),
            f: Math.max(scrollHeight - offsetHeight)
        };

        var isScrolling = this._isScrolling = {
            e: maxOffsets.e > 0,
            f: maxOffsets.f > 0
        };
        isScrolling.general = isScrolling.e || isScrolling.f;

        // hide/show scrollbars
        var bars = dom.bars;
        if(bars){
            var axes = ["e", "f"];
            for (var i = 0, axis, bar; (axis = axes[i++]); ){
                bar = bars[axis];
                bar.className = bar.className.replace(" active", "");
                if (isScrolling[axis]) {
                    bar.className += " active";
                }
            }

            // calculate and apply scroll indicator sizes
            var scrollHandleMinSize = this.config.scrollHandleMinSize;
            var barMetrics = this._barMetrics
            var availLength = barMetrics.availLength;
            availLength.e = bars.e.offsetWidth;
            availLength.f = bars.f.offsetHeight;

            var barSizes = barMetrics.sizes;
            barSizes.e = Math.round(Math.max(
                availLength.e * offsetWidth / scrollWidth
            ));
            barSizes.f = Math.round(Math.max(
                availLength.e * offsetHeight / scrollHeight
            ));

            var endSize = barMetrics.endSize;
            var setOffset = TouchScroll._setStyleOffset;
            for (var i = 0, axis, parts, style1, matrix, size, scale; (axis = axes[i++]); ){
                parts = bars.parts[axis];
                style1 = parts[1].style;
                offset = new WebKitCSSMatrix();
                size = barSizes[axis];
                scale = size - endSize * 2;
                matrix[axis] = endSize;
                setOffset(style1, matrix)
                style1.webkitTransform += " scale(" + scale + ")";

                barMetrics.maxOffsets[axis] = availLength[axis] - size;
                matrix[axis] += scale - 1;
                setOffset(parts[2].style, offset);
            };
        }
    },

    /**
     * Creates a keyframes rule, appends it to the stylesheet, and returns an
     * array containg references to the single keyframes.
     *
     * The array has a "name" property, containing the name of the
     * keyframes rule.
     */
    _createKeyframes: function _createKeyframes() {
        var sheet = this._styleSheet, i = sheet.length;
        var name = "touchScrollAnimation-" + this._numKeyframeRules++;
        i = sheet.insertRule("@-webkit-keyframes " + name + " {0%{} 33%{} 66%{} to{}}", i);
        var keyframes = sheet.cssRules[i];
        var frameRefs = [
            keyframes.findRule("0%"), // iPhone does not support finding keywords (from/to)
            keyframes.findRule("33%"),
            keyframes.findRule("66%"),
            keyframes.findRule("100%")
        ];
        frameRefs.name = name;

        return frameRefs;
    },

    /**
     * Gets the current offset from the scrolling layers.
     *
     * @param {Boolean} round Whether to round the offfset to whole pixels.
     * @returns {WebKitCSSMatrix} This is a reference to {@link _scrollOffset}
     */
    _determineOffset: function _determineOffset(round){
        var isScrolling = this._isScrolling;
        var scrollers = this._dom.scrollers;
        var offset = this._scrollOffset;

        for (var i = 0, axes = ["e", "f"], axis, offset; axis = axes[i++]; ) {
            if (isScrolling[axis]) {
                var offset = TouchScroll._getNodeOffset(scrollers[axis])[axis]
                if(round){
                    // This is a high performance rounding method:
                    // Add 0.5 and then do a double binary inversion
                    offset = ~~(offset + 0.5);
                }
                offset[axis] = offset;
            }
        }

        return offset;
    },

    /**
     * Initializes the DOM of the scroller.
     *
     * Inserts additional elements for scrolling layers and scrollbars/indicators.
     *
     * @private
     * @param {Boolean} scrollbars Whether to build scrollbars.
     */
    _initDom: function _initDom(scrollbars) {
        var dom = this._dom;
        var scrollElement = dom.outer;

        scrollElement.className += " touchScroll";

        // remove scroller contents
        var firstChild, children = document.createDocumentFragment();
        while ((firstChild = scrollElement.firstChild)) {
            children.appendChild(firstChild);
        }

        // set innerHTML from template
        scrollElement.innerHTML = TouchScroll._scrollerTemplate;
        if(scrollbars){
            scrollElement.innerHTML += TouchScroll._scrollbarTemplate;
        }

        // setup references to scroller HTML nodes
        var scrollers = dom.scrollers = {
            inner: scrollElement.querySelector(".tsInner")
        };
        scrollers.e = scrollers.inner.parentNode;
        scrollers.f = scrollers.inner;

        // add animation names
        var animations = this._animations;
        scrollers.e.style.webkitAnimationName = animations.scrollers.e.name;
        scrollers.f.style.webkitAnimationName = animations.scrollers.f.name;

        if(scrollbars){
            var bars = dom.bars = {
                outer: scrollElement.querySelector(".tsBars"),
                parts: {}
            };

            for (var i = 0, axes = ["e", "f"], axis, bar; (axis = axes[i++]); ){
                var bar = bars[axis] = scrollElement.querySelector(".tsBar"+axis.toUpperCase());
                bars.parts[axis] = [
                    bar.querySelector(".tsBar1"),
                    bar.querySelector(".tsBar2"),
                    bar.querySelector(".tsBar3")
                ];

                // add animation name
                bar.style.webkitAnimationName = animations.bars[axis];
            };

            var cs = window.getComputedStyle(bars.parts.e[0]);
            this._barMetrics.endSize =
                parseFloat(cs.paddingTop) +
                parseFloat(cs.height) +
                parseFloat(cs.paddingBottom);
            cs = null; // release live objects
        }

        // register event listeners
        scrollElement.addEventListener(TouchScroll._events.start, this);

        // put original contents back into DOM
        dom.scrollers.inner.appendChild(children);

        this.setupScroller();
    },

    /**
     * Stops all running animations.
     */
    _stopAnimations: function _stopAnimations(){
        var dom = this._dom;
        var scrollers = this._dom.scrollers;
        var bars = dom.bars;
        var offset = this._determineOffset();

        for (var axes = ["e", "f"], axis, style, matrix; axis = axis[i++]; ) {
            style = scrollers[axis].style;
            style.webkitAnimationDuration = 0;

            if (bars) {
                bars[axis].style.webkitAnimationDuration = 0;
            }

            matrix = new WebKitCSSMatrix();
            matrix[axis] = offset[axis];
            TouchScroll._setStyleOffset(style, matrix);
        }
    }
};

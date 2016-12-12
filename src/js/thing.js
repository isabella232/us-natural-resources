// NPM modules
var d3 = require('d3');
var geo = require('d3-geo-projection');
var topojson = require('topojson');
var textures = require('textures');

// Local modules
var features = require('./detectFeatures')();
var fm = require('./fm');
var utils = require('./utils');
var geomath = require('./geomath');

// Globals
var MOBILE_BREAKPOINT = 600;
var SIMPLE_LABELS = [];

// {
//     'lat': 0,
//     'lng': 0,
//     'label': 'My label',
//     'class': ''
// }

// Map configurations
// var configure = require('./maps/europe.js');
var configure = require('./maps/usa.js');
// var configure = require('./maps/world.js')
// var configure = require('./maps/streets.js');

// Global vars
var isMobile = false;
var topoData = {};
var identityProjection = null;


/**
 * Initialize the graphic.
 *
 * Fetch data, format data, cache HTML references, etc.
 */
function init() {
    // Used for computing centroids in coordinate space
    identityProjection = d3.geo.path()
        .projection({stream: function(d) { return d; }});

	d3.json('data/geodata.json', function(error, data) {
        // Extract topojson features
        for (var key in data['objects']) {
            topoData[key] = topojson.feature(data, data['objects'][key]);
        }

        render();
        $(window).resize(utils.throttle(onResize, 250));
    });
}

/**
 * Invoke on resize. By default simply rerenders the graphic.
 */
function onResize() {
	render();
}

/**
 * Figure out the current frame size and render the graphic.
 */
function render() {
	var containerWidth = $('#interactive-content').width();

    if (!containerWidth) {
        containerWidth = DEFAULT_WIDTH;
    }

    if (containerWidth <= MOBILE_BREAKPOINT) {
        isMobile = true;
    } else {
        isMobile = false;
    }

    // What kind of map are we making?
    var configuration = configure(containerWidth);

    // Render the map!
    renderMap(configuration, {
        container: '#graphic',
        width: containerWidth,
        data: topoData
    });

    // Resize
    fm.resize();
}

var renderMap = function(typeConfig, instanceConfig) {
    /*
     * Setup
     */
    // Calculate actual map dimensions
    var mapWidth = instanceConfig['width'];
    var mapHeight = Math.ceil(instanceConfig['width'] / typeConfig['aspect_ratio']);

    // Clear existing graphic (for redraw)
    var containerElement = d3.select(instanceConfig['container']);
    containerElement.html('');

    /*
     * Create the map projection.
     */
    var centroid = typeConfig['centroid'];
    var mapScale = mapWidth * typeConfig['scale_factor'];

    var projection = typeConfig['projection']
        .scale(mapScale)
        .translate([mapWidth / 2, mapHeight / 2]);

    var path = d3.geo.path()
        .projection(projection)
        .pointRadius(typeConfig['dot_radius'] * mapScale);

    /*
     * Create the root SVG element.
     */
    var chartWrapper = containerElement.append('div')
        .attr('class', 'graphic-wrapper');

    var chartElement = chartWrapper.append('svg')
        .attr('width', mapWidth)
        .attr('height', mapHeight);

    var coalStripes = textures.lines()
        .thicker()
        .size(7)
        .stroke('rgba(196, 196, 196, 0.8)')
        .background('rgba(22, 141, 217, 0.8)');

    var solarStripes = textures.lines()
        .thicker()
        .size(12)
        .orientation('7/8')
        .stroke('rgba(196, 196, 196, 0.8)')
        .background('rgba(209, 144, 182, 0.8)');

    chartElement.call(coalStripes);
    chartElement.call(solarStripes);

    /*
     * Render graticules.
     */
    if (typeConfig['graticules']) {
        var graticule = d3.geo.graticule();

        chartElement.append('g')
            .attr('class', 'graticules')
            .append('path')
                .datum(graticule)
                .attr('d', path);
    }

    /*
     * Render paths.
     */
    var pathsElement = chartElement.append('g')
        .attr('class', 'paths');

    function classifyFeature(d) {
        var c = [];

        if (d['id']) {
            c.push(utils.classify(d['id']));
        }

        for (var property in d['properties']) {
            var value = d['properties'][property];

            c.push(utils.classify(property + '-' + value));
        }

        return c.join(' ');
    }

    function renderPaths(group) {
        pathsElement.append('g')
            .attr('class', group)
            .selectAll('path')
                .data(instanceConfig['data'][group]['features'])
            .enter().append('path')
                .attr('d', path)
                .attr('class', classifyFeature);
    }

    for (var layer in typeConfig['paths']) {
        renderPaths(typeConfig['paths'][layer]);
    }

    // Second state layer
    pathsElement.append('g')
        .attr('class', 'outlines')
        .selectAll('path')
            .data(instanceConfig['data']['states']['features'])
        .enter().append('path')
            .attr('d', path)
            .attr('class', classifyFeature);

    d3.selectAll('.coal path')
        .style('fill', coalStripes.url());

    d3.selectAll('.solar path')
        .style('fill', solarStripes.url());

    /*
     * Render labels.
     */
    var labelsElement = chartElement.append('g')
        .attr('class', 'labels');

    function renderLabels(group) {
        labelsElement.append('g')
            .attr('class', group)
            .selectAll('text')
                .data(instanceConfig['data'][group]['features'])
            .enter().append('text')
                .attr('class', classifyFeature)
                .attr('transform', function(d) {
                    var point = null;

                    if (d['geometry']['type'] == 'Point') {
                        // Note: copy by value to prevent insanity
                        point = d['geometry']['coordinates'].slice();
                    } else {
                        point = identityProjection.centroid(d);
                    }

                    if (group in typeConfig['label_nudges']) {
                        var nudge = typeConfig['label_nudges'][group][d['id']];

                        if (nudge === undefined) {
                            nudge = typeConfig['label_nudges'][group]['default'];
                        }

                        if (nudge !== undefined) {
                            point[0] += nudge[0];
                            point[1] += nudge[1];
                        }
                    }

                    return 'translate(' + projection(point) + ')';
                })
                .text(function(d) {
                    if (group in typeConfig['label_subs']) {
                        var sub = typeConfig['label_subs'][group][d['id']];

                        if (sub !== undefined) {
                            return sub;
                        }
                    }

                    return d['id']
                });
    }

    for (var layer in typeConfig['labels']) {
        renderLabels(typeConfig['labels'][layer]);
    }

    labelsElement.append('g')
        .attr('class', 'simple')
        .selectAll('text')
            .data(SIMPLE_LABELS)
        .enter().append('text')
            .attr('class', function(d) {
                return d['class'];
            })
            .attr('transform', function(d) {
                return 'translate(' + projection([d['lng'], d['lat']]) + ')';
            })
            .text(function(d) {
                return d['label'];
            });

    /*
     * Render a scale bar.
     */
    if (typeConfig['scale_bar_distance']) {
        var scaleBarDistance = typeConfig['scale_bar_distance'];
        var scaleBarStart = [10, mapHeight - 35];
        var scaleBarEnd = geomath.calculateScaleBarEndPoint(projection, scaleBarStart, scaleBarDistance);

        chartElement.append('g')
            .attr('class', 'scale-bar')
            .append('line')
            .attr('x1', scaleBarStart[0])
            .attr('y1', scaleBarStart[1])
            .attr('x2', scaleBarEnd[0])
            .attr('y2', scaleBarEnd[1]);

        var label = ' mile';

        if (scaleBarDistance != 1) {
            label += 's';
        }

        d3.select('.scale-bar')
            .append('text')
            .attr('x', scaleBarEnd[0] + 5)
            .attr('y', scaleBarEnd[1])
            .text(scaleBarDistance + label);
    }

    /*
     * Reposition footer.
     */
    d3.selectAll('.footer')
        .style('top', (mapHeight - 10) + 'px')
}

// Bind on-load handler
$(document).ready(function() {
	init();
});

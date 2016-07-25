var assert = require("assert");
var walk = require("glTF-walker");
var URL = require("url");
var Q = require("q");
var GLTFScene = require("./gltf-scene.js");

var GLTFFormatHandler = function () {
    XML3D.resource.FormatHandler.call(this);
};
XML3D.createClass(GLTFFormatHandler, XML3D.resource.FormatHandler);

GLTFFormatHandler.prototype.isFormatSupported = function (response) {
    if (response.headers.has("Content-Type")) {
        return response.headers.get("Content-Type") === "application/json" ||
            response.headers.get("Content-Type") === "application/octet-stream";  // Github pages delivers with this content-type :(
    }
};

/**
 * @param response A virgin fetch response object
 * @return {Promise} that resolves as soon as all dependent objects have been fetched and glTF has been processed
 */
GLTFFormatHandler.prototype.getFormatData = function (response) {
    return response.json().then(function (jsonStructure) {
        var baseURL = response.url;

        var resourcePromises = [];

        walk(jsonStructure, {
            buffers: function (buffer) {
                if (buffer._buffer) {
                    return;
                }
                var uri = buffer._uri;
                resourcePromises.push(XML3D.resource.fetch(uri).then(function (res) {
                    if (!res.ok) {
                        throw new Error(res.statusText);
                    }
                    return res.arrayBuffer().then(function (ab) {
                        buffer._buffer = ab;
                        return buffer;
                    });
                }));
            },
            materials: function (material, id) {
                material._uri = baseURL + "#" + id;
            },
            images: function (image) {

            }
        }, {
            baseURL: baseURL
        });

        return Q.all(resourcePromises).then(function () {
            XML3D.debug.logInfo("GLTF-Plugin: All secondary glTF resources have been loaded.");

            var start = window.performance.now();
            var scene = new GLTFScene(jsonStructure, baseURL);
            var duration = window.performance.now() - start;
            XML3D.debug.logInfo("Processed glTF in", duration.toFixed(2), "ms");

            return scene;

        }).catch(function (e) {
            e.fileName = baseURL;
            XML3D.debug.logError("GLTF-Plugin: Failed to process glTF file ", baseURL, "\n", e);
            throw e;
        });

    }).catch(function (e) {
        XML3D.debug.logError("GLTF-Plugin: Failed to process glTF file", response.url, "\n", e);
        throw e;
    });

};


GLTFFormatHandler.prototype.getFragmentData = function (scene, fragment) {
    if (!fragment) {
        return scene.root;
    }
    var data = scene.resourceMap.get(fragment);
    if (!data) {
        XML3D.debug.logError("GLTF-Plugin: Failed to resolve fragment #" + fragment + " in " + scene.uri.href);
    }
    return data;
};

GLTFFormatHandler.prototype.getAdapter = function (fragmentData, aspect) {
    switch (aspect) {
        case "data":
            return {
                getAsset: function () {
                    return fragmentData;
                }
            };
        case "scene":
            return {
                getMaterialConfiguration: function () {
                    return fragmentData;
                }
            };
        default:
            throw new Error("Unknown aspect" + aspect);
    }
};

XML3D.resource.registerFormatHandler(new GLTFFormatHandler());


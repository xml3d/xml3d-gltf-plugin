var assert = require("assert");
var walk = require("glTF-walker");
var URL = require("url");
var Q = require("q");
var GLTFScene = require("./gltf-scene.js");

var GLTFFormatHandler = function () {
    XML3D.resource.JSONFormatHandler.call(this);
};
XML3D.createClass(GLTFFormatHandler, XML3D.resource.JSONFormatHandler);

GLTFFormatHandler.prototype.isFormatSupported = function (response, responseType, mimetype) {
    return mimetype === "application/json";
};

GLTFFormatHandler.prototype.getFormatData = function (jsonStructure, responseType, mimetype, callback, baseURL) {
    try {
        assert(baseURL, "No baseURL defined. Probably wrong version of xml3d.js.");
        baseURL = URL.parse(baseURL);

        var resourcePromises = [];

        walk(jsonStructure, {
            buffers: function () {
                if(this._buffer) {
                    return;
                }
                var uri = URL.parse(this.uri);
                if (!this.protocol) {
                    uri = URL.parse(URL.resolve(baseURL, uri));
                }
                var obj = this;
                resourcePromises.push(fetch(uri.href).then(function (res) {
                    if (!res.ok) {
                        throw new Error(res.statusText);
                    }
                    return res.arrayBuffer().then(function (buffer) {
                        obj._buffer = buffer;
                        return obj;
                    });
                }));
            },
            materials: function (id) {
                this._url = baseURL.href + "#" + id;
            },
            images: function () {
                var uri = URL.parse(this.uri);
                if (!this.protocol) {
                    uri = URL.parse(URL.resolve(baseURL, uri));
                }
                this._url = uri.href;
            }
        });

        Q.all(resourcePromises).then(function () {
            XML3D.debug.logInfo("GLTF-Plugin: All secondary glTF resources have been loaded.");
            var result = new GLTFScene(jsonStructure, baseURL);
            callback(true, result);
        }).catch(function (e) {
            e.fileName = baseURL.href;
            XML3D.debug.logError("GLTF-Plugin: Failed to process glTF file ", baseURL.href, "\n", e);
            callback(false);
        });

    } catch (e) {
        XML3D.debug.logError("GLTF-Plugin: Failed to process glTF file", baseURL.href, "\n", e);
        callback(false);
    }
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

var formatHandlerInstance = new GLTFFormatHandler();
XML3D.resource.registerFormat(formatHandlerInstance);

var XML3DGLTFDataFactory = function () {
    XML3D.resource.AdapterFactory.call(this, "data");
};
XML3D.createClass(XML3DGLTFDataFactory, XML3D.resource.AdapterFactory, {
    aspect: "data",
    createAdapter: function (object) {
        return {
            getAsset: function () {
                return object;
            }
        };
    }
});

formatHandlerInstance.registerFactoryClass(XML3DGLTFDataFactory);

var XML3DGLTFMaterialFactory = function () {
    XML3D.resource.AdapterFactory.call(this, "webgl");
};
XML3D.createClass(XML3DGLTFMaterialFactory, XML3D.resource.AdapterFactory, {
    aspect: "webgl",
    createAdapter: function (material) {
        return {
            getMaterialConfiguration: function () {
                // console.log("MATERIAL", material);
                return material;
            }
        };
    }
});

formatHandlerInstance.registerFactoryClass(XML3DGLTFMaterialFactory);


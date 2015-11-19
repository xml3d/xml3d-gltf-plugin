var assert = require("assert");

module.exports = GLTFScene;

var matId = 500;

function GLTFScene(structure, uri) {
    this.resourceMap = new Map();
    this.root = new XML3D.resource.Asset();
    this.uri = uri;
    this.process(structure);
}


GLTFScene.prototype = {
    process: function (structure) {
        XML3D.debug.logInfo("GLTF-Plugin: Creating XML3D from", this.uri.href);
        var name;

        for (name in structure.materials) {
            var material = this.createMaterial(structure.materials[name]);
            this.resourceMap.set(name, material);
        }

        for (name in structure.scenes) {
            var asset = this.createAssetFromScene(structure.scenes[name]);
            this.resourceMap.set(name, asset);
            if (name == structure.scene) {
                this.root = asset;
            }
        }
        // console.dir(this.resourceMap);
    },

    createMaterial: function (material) {
        assert(material, "No material given");
        var materialData = new Xflow.DataNode();

        var parameters = material.technique.parameters;

        for (var name in material.values) {
            if (material.values.hasOwnProperty(name)) {
                var value = material.values[name];
                var input;

                //console.log(name, value);
                if (value.sampler) {
                    assert.equal(value.format || 6408, 6408, "Unknown texture format: " + value.format);
                    assert.equal(value.type || 5121, 5121, "Unknown texture type: " + value.type);
                    switch (name) {
                        case "diffuse":
                            input = createXflowTexture(value.source, value.sampler, "diffuseTexture");
                            break;
                        default:
                            // console.log("Unmapped texture", name, value);
                            input = createXflowTexture(value.source, value.sampler, name);
                    }
                } else {
                    var parameter = parameters[name];
                    var xflowType = getXflowType(parameter.type);

                    if (xflowType == -1) {
                        XML3D.debug.logWarning("GLTF-Plugin: Type of uniform", name, "is not yet supported:", parameter.type);
                        continue;
                    }
                    switch (name) {
                        case "specular":
                            input = createXflowInputFromValue(value.slice(0, 3), 3, "specularColor");
                            break;
                        case "diffuse":
                            input = createXflowInputFromValue(value.slice(0, 3), 3, "diffuseColor");
                            break;
                        case "shininess":
                            input = createXflowInputFromValue(value / 256, 1, "shininess");
                            break;
                        default:
                            // console.log("Unmapped uniform", name, value);
                            input = createXflowInputFromValue(value, xflowType, name);

                    }
                }
                materialData.appendChild(input);

            }
        }

        // TODO: Expose and use material configuration
        return {
            id: matId++,
            model: {
                type: "urn",
                urn: {
                    scheme: "urn",
                    path: "xml3d:material:phong"
                }
            },
            dataNode: materialData
        }
    },

    createAssetFromScene: function (scene) {
        assert(scene, "No scene given.");
        assert(scene.nodes && scene.nodes.length, "Scene is empty.");

        var result = new XML3D.resource.Asset();

        scene.nodes.forEach(function (node) {
            var subDatas = this.createSubDatasFromNode(node, XML3D.math.mat4.create());
            subDatas.forEach(function (subData) {
                result.appendChild(subData);
            })
        }, this);
        return result;
    },

    createSubDatasFromNode: function (node, parentTransformation) {
        assert(node, "No node given");
        assert(parentTransformation, "No parent transformation given");
        var result = [];

        var matrix = XML3D.math.mat4.clone(parentTransformation);
        if (node.matrix) {
            matrix = XML3D.math.mat4.multiply(matrix, parentTransformation, node.matrix);
        } else {
            matrix = XML3D.math.mat4.fromRotationTranslationScale(matrix,
                node.rotation || [0, 0, 0, 1],
                node.translation || [0, 0, 0],
                node.scale || [1, 1, 1]
            );
            matrix = XML3D.math.mat4.multiply(matrix, parentTransformation, matrix);
        }

        if (node.meshes) {
            node.meshes.forEach(function (mesh) {
                mesh.primitives.forEach(function (p) {
                    var subData = this.createSubDataFromPrimitive(p, matrix);
                    result.push(subData);
                }, this);
            }, this);
        }


        node.children.forEach(function (child) {
            var subDatas = this.createSubDatasFromNode(child, matrix);
            Array.prototype.push.apply(result, subDatas);
        }, this);

        this.resourceMap.set(node._id, result);

        return result;
    },

    createSubDataFromPrimitive: function (primitive, transformation) {
        assert(transformation, "No transformation given");
        var assetData = this.createMeshDataFromPrimitive(primitive);
        var result = new XML3D.resource.SubData(new Xflow.DataNode(), assetData);
        result.setMeshType("triangles");
        result.setTransform(transformation);
        result.setMaterial(primitive.material._url);
        return result;
    },
    createMeshDataFromPrimitive: function (primitive) {
        assert(primitive, "No primitive given");
        var meshData = new Xflow.DataNode();
        if (primitive.indices) {
            var input = createXflowInputFromAccessor(primitive.indices, "index");
            meshData.appendChild(input);
        }
        var rename = [];
        for (var name in primitive.attributes) {
            var attribute = createXflowInputFromAccessor(primitive.attributes[name], name);
            if(!attribute) {
                continue;
            }
            meshData.appendChild(attribute);
            if (name in ATTRIBUTE_MAP) {
                rename.push(ATTRIBUTE_MAP[name] + ": " + name);
            }
        }
        if (rename.length) {
            meshData.setFilter("rename( { " + rename.join(",") + "})");
        }
        return meshData;
    }

};


var ATTRIBUTE_MAP = {
    "POSITION": "position",
    "NORMAL": "normal",
    "TEXCOORD_0": "texcoord"
};


function createXflowInput(name) {
    assert(name, "No name for Xflow input given.");
    var node = new Xflow.InputNode();
    node.name = name;
    node.key = 0;
    return node;
}

function createXflowBufferFromArray(arr, type) {
    var value;
    switch (type) {
        case 1:
        case 2:
        case 3:
        case 4:
            value = new Float32Array(arr);
            break;
        default:
            throw new Error("Unknown buffer type: " + type);

    }
    return new Xflow.BufferEntry(type, value);
}

function createXflowInputFromValue(arr, type, name) {
    var node = createXflowInput(name);
    if (!Array.isArray(arr)) {
        arr = [arr];
    }
    node.data = createXflowBufferFromArray(arr, type);
    return node;
}

function createXflowInputFromAccessor(accessor, name) {
    var node = createXflowInput(name);

    node.data = createXflowBufferFromAccessor(accessor);
    return node;
}

function createXflowBufferFromAccessor(accessor) {
    var bufferView = accessor.bufferView;
    var buffer = bufferView.buffer._buffer;
    assert(buffer);
    var byteOffset = accessor.byteOffset + bufferView.byteOffset;

    var tupleSize = componentCount(accessor.type);
    var bytesPerElement = BYTES_PER_ELEMENT[accessor.componentType];
    var tupleByteSize = tupleSize * bytesPerElement;
    assert(bytesPerElement);

    var length = tupleSize * accessor.count;
    assert(length);
    var stride = accessor.byteStride;
    var value, type, tmp, i;

    if(stride && stride != tupleByteSize) {
        throw new Error("Buffer strides are not yet supported");
    }


    switch (accessor.componentType) {
        case 5120: // BYTE
            assert(tupleSize == 1, "Xflow supports SCALAR byte values only. Found type: " + accessor.type);
            value = new Int8Array(buffer, byteOffset, length);
            type = 50;
            break;
        case 5121: // UNSIGNED_BYTE
            assert(tupleSize == 1, "Xflow supports SCALAR unsigned byte values only. Found type: " + accessor.type);
            value = new Uint8Array(buffer, byteOffset, length);
            break;
        case 5122: // SHORT
            tmp = new Int16Array(buffer, byteOffset, length);
            value = new Int32Array(length);
            for (i = 0; i < length; i++) {
                value[i] = tmp[i]
            }
            type = tupleSize == 1 ? 20 : tupleSize == 4 ? 21 : 0;
            break;
        case 5123: // UNSIGNED SHORT
            tmp = new Uint16Array(buffer, byteOffset, length);
            value = new Int32Array(length);
            for (i = 0; i < length; i++) {
                value[i] = tmp[i]
            }
            type = tupleSize == 1 ? 20 : tupleSize == 4 ? 21 : 0;
            break;
        case 5126 : // FLOAT
            value = new Float32Array(buffer, byteOffset, length);
            type = xflowFloatTypes(accessor.type);
            break;
        default:
            throw new Error("Unknown componentType: " + componentType);
    }
    assert(tupleSize, "Xflow does not support accessor type" + accessor.type);

    return new Xflow.BufferEntry(type, value);
}

function createXflowTexture(source, sampler, name) {
    assert(source._url);
    var inputNode = createXflowInput(name);

    var textureEntry = new Xflow.TextureEntry();
    var image = new Image();
    image.onload = function (evt) {
        textureEntry.setImage(evt.target, true);
    };

    var config = textureEntry.getSamplerConfig();
    config.set({
        wrapS: sampler.wrapS || 10497, // REPEAT
        wrapT: sampler.wrapT || 10497, // REPEAT
        minFilter: sampler.minFilter || 9986, // NEAREST_MIPMAP_LINEAR
        magFilter: sampler.magFilter || 9729, // LINEAR
        flipY: false,
        generateMipMap: shouldGenerateMipMaps(sampler.minFilter, sampler.magFilter)
    });
    inputNode.data = textureEntry;

    image.src = source._url;
    return inputNode;
}

function shouldGenerateMipMaps(minFilter, magFilter) {
    return (minFilter != 9728 && minFilter != 9729 ) || (magFilter != 9728 && magFilter != 9729);
}

function xflowFloatTypes(type) {
    switch (type) {
        case "SCALAR":
            return 1;
        case "VEC2":
            return 2;
        case "VEC3":
            return 3;
        case "VEC4":
            return 4;
        case "MAT2":
            return 4;
        case "MAT3":
            return 5;
        case "MAT4":
            return 10;
        default:
            throw new Error("Unknown type: " + type);
    }
}

function getXflowType(type) {
    switch (type) {
        case 5120: // (BYTE)
        case 5121: // (UNSIGNED_BYTE)
        case 5122: // (SHORT)
        case 5123: // (UNSIGNED_SHORT)
        case 5124: // (INT)
        case 5125: // (UNSIGNED_INT)
        case 5126: // (FLOAT)
            return 1;
        case 35664: // (FLOAT_VEC2)
            return 2;
        case 35665: // (FLOAT_VEC3)
            return 3;
        case 35666: // (FLOAT_VEC4)
            return 4;
        case 35667: // (INT_VEC2)
        case 35668: // (INT_VEC3)
        case 35669: // (INT_VEC4)
        case 35670: // (BOOL)
        case 35671: // (BOOL_VEC2)
        case 35672: // (BOOL_VEC3)
        case 35673: // (BOOL_VEC4)
        case 35674: // (FLOAT_MAT2)
            return 4;
        case 35675: // (FLOAT_MAT3)
            return 5;
        case 35676: // (FLOAT_MAT4)
            return 10;
        case 35678: // (SAMPLER_2D).
        default:
            return -1
    }

}


var BYTES_PER_ELEMENT = {
    5110: 1,
    5121: 1,
    5122: 2,
    5123: 2,
    5126: 4
};


function componentCount(type) {
    switch (type) {
        case "SCALAR":
            return 1;
        case "VEC2":
            return 2;
        case "VEC3":
            return 3;
        case "VEC4":
            return 4;
        case "MAT2":
            return 4;
        case "MAT3":
            return 9;
        case "MAT4":
            return 16;
        default:
            throw new Error("Unknown type: " + type);
    }
}



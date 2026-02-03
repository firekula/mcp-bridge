"use strict";

module.exports = {
    "set-property": function (event, args) {
        const { id, path, value } = args;

        // 1. 获取节点
        let node = cc.engine.getInstanceById(id);

        if (node) {
            // 2. 修改属性
            if (path === "name") {
                node.name = value;
            } else {
                node[path] = value;
            }

            // 3. 【解决报错的关键】告诉编辑器场景变脏了（需要保存）
            // 在场景进程中，我们发送 IPC 给主进程
            Editor.Ipc.sendToMain("scene:dirty");

            // 4. 【额外补丁】通知层级管理器（Hierarchy）同步更新节点名称
            // 否则你修改了名字，层级管理器可能还是显示旧名字
            Editor.Ipc.sendToAll("scene:node-changed", {
                uuid: id,
            });

            if (event.reply) {
                event.reply(null, `Node ${id} updated to ${value}`);
            }
        } else {
            if (event.reply) {
                event.reply(new Error("Scene Script: Node not found " + id));
            }
        }
    },
    "get-hierarchy": function (event) {
        const scene = cc.director.getScene();

        function dumpNodes(node) {
            // 【优化】跳过编辑器内部的私有节点，减少数据量
            if (node.name.startsWith("Editor Scene") || node.name === "gizmoRoot") {
                return null;
            }

            let nodeData = {
                name: node.name,
                uuid: node.uuid,
                active: node.active,
                position: { x: Math.round(node.x), y: Math.round(node.y) },
                scale: { x: node.scaleX, y: node.scaleY },
                size: { width: node.width, height: node.height },
                // 记录组件类型，让 AI 知道这是个什么节点
                components: node._components.map((c) => c.__typename),
                children: [],
            };

            for (let i = 0; i < node.childrenCount; i++) {
                let childData = dumpNodes(node.children[i]);
                if (childData) nodeData.children.push(childData);
            }
            return nodeData;
        }

        const hierarchy = dumpNodes(scene);
        if (event.reply) event.reply(null, hierarchy);
    },

    "update-node-transform": function (event, args) {
        const { id, x, y, scaleX, scaleY, color } = args;
        Editor.log(`[scene-script] update-node-transform called for ${id} with args: ${JSON.stringify(args)}`);

        let node = cc.engine.getInstanceById(id);

        if (node) {
            Editor.log(`[scene-script] Node found: ${node.name}, Current Pos: (${node.x}, ${node.y})`);

            if (x !== undefined) {
                node.x = Number(x); // 强制转换确保类型正确
                Editor.log(`[scene-script] Set x to ${node.x}`);
            }
            if (y !== undefined) {
                node.y = Number(y);
                Editor.log(`[scene-script] Set y to ${node.y}`);
            }
            if (scaleX !== undefined) node.scaleX = Number(scaleX);
            if (scaleY !== undefined) node.scaleY = Number(scaleY);
            if (color) {
                const c = new cc.Color().fromHEX(color);
                // 使用 scene:set-property 实现支持 Undo 的颜色修改
                // 注意：IPC 消息需要发送到场景面板
                Editor.Ipc.sendToPanel("scene", "scene:set-property", {
                    id: id,
                    path: "color",
                    type: "Color",
                    value: { r: c.r, g: c.g, b: c.b, a: c.a }
                });
                // 既然走了 IPC，就不需要手动 set node.color 了，也不需要重复 dirty
            }

            Editor.Ipc.sendToMain("scene:dirty");
            Editor.Ipc.sendToAll("scene:node-changed", { uuid: id });

            Editor.log(`[scene-script] Update complete. New Pos: (${node.x}, ${node.y})`);
            if (event.reply) event.reply(null, "Transform updated");
        } else {
            Editor.error(`[scene-script] Node not found: ${id}`);
            if (event.reply) event.reply(new Error("Node not found"));
        }
    },
    "create-node": function (event, args) {
        const { name, parentId, type } = args;
        const scene = cc.director.getScene();
        if (!scene) {
            if (event.reply) event.reply(new Error("Scene not ready or loading."));
            return;
        }

        let newNode = null;

        // 特殊处理：如果是创建 Canvas，自动设置好适配
        if (type === "canvas" || name === "Canvas") {
            newNode = new cc.Node("Canvas");
            let canvas = newNode.addComponent(cc.Canvas);
            newNode.addComponent(cc.Widget);
            // 设置默认设计分辨率
            canvas.designResolution = cc.size(960, 640);
            canvas.fitHeight = true;
            // 自动在 Canvas 下创建一个 Camera
            let camNode = new cc.Node("Main Camera");
            camNode.addComponent(cc.Camera);
            camNode.parent = newNode;
        } else if (type === "sprite") {
            newNode = new cc.Node(name || "New Sprite");
            newNode.addComponent(cc.Sprite);
        } else if (type === "label") {
            newNode = new cc.Node(name || "New Label");
            let l = newNode.addComponent(cc.Label);
            l.string = "New Label";
        } else {
            newNode = new cc.Node(name || "New Node");
        }

        // 设置层级
        let parent = parentId ? cc.engine.getInstanceById(parentId) : scene;
        if (parent) {
            newNode.parent = parent;

            // 【优化】通知主进程场景变脏
            Editor.Ipc.sendToMain("scene:dirty");

            // 【关键】使用 setTimeout 延迟通知 UI 刷新，让出主循环
            setTimeout(() => {
                Editor.Ipc.sendToAll("scene:node-created", {
                    uuid: newNode.uuid,
                    parentUuid: parent.uuid,
                });
            }, 10);

            if (event.reply) event.reply(null, newNode.uuid);
        }
    },

    "manage-components": function (event, args) {
        const { nodeId, action, componentType, componentId, properties } = args;
        let node = cc.engine.getInstanceById(nodeId);

        // 辅助函数：应用属性并智能解析
        const applyProperties = (component, props) => {
            if (!props) return;
            // 尝试获取组件类的属性定义
            const compClass = component.constructor;

            for (const [key, value] of Object.entries(props)) {
                // 检查属性是否存在
                if (component[key] !== undefined) {
                    let finalValue = value;

                    // 【关键修复】智能组件引用赋值
                    // 如果属性期望一个组件 (cc.Component子类) 但传入的是节点/UUID，尝试自动获取组件
                    try {
                        // 检查传入值是否是字符串 (可能是 UUID) 或 Node 对象
                        let targetNode = null;
                        if (typeof value === 'string') {
                            targetNode = cc.engine.getInstanceById(value);

                            // Fallback for compressed UUIDs
                            if (!targetNode && Editor.Utils && Editor.Utils.UuidUtils) {
                                try {
                                    const decompressed = Editor.Utils.UuidUtils.decompressUuid(value);
                                    if (decompressed !== value) {
                                        targetNode = cc.engine.getInstanceById(decompressed);
                                    }
                                } catch (e) { }
                            }

                            if (targetNode) {
                                Editor.log(`[scene-script] Resolved node: ${value} -> ${targetNode.name}`);
                            } else if (value.length > 20) {
                                Editor.warn(`[scene-script] Failed to resolve node: ${value}`);
                            }
                        } else if (value instanceof cc.Node) {
                            targetNode = value;
                        }

                        if (targetNode) {
                            // 尝试获取属性定义类型
                            let typeName = null;


                            // 优先尝试 getClassAttrs (Cocos 2.x editor environment)
                            if (cc.Class.Attr.getClassAttrs) {
                                const attrs = cc.Class.Attr.getClassAttrs(compClass);
                                // attrs 是整个属性字典 { name: { type: ... } }
                                if (attrs) {
                                    if (attrs[key] && attrs[key].type) {
                                        typeName = attrs[key].type;
                                    } else if (attrs[key + '$_$ctor']) {
                                        // 编辑器环境下，自定义组件类型可能存储在 $_$ctor 后缀中
                                        typeName = attrs[key + '$_$ctor'];
                                    }
                                }
                            }
                            // 兼容性尝试 getClassAttributes
                            else if (cc.Class.Attr.getClassAttributes) {
                                const attrs = cc.Class.Attr.getClassAttributes(compClass, key);
                                if (attrs && attrs.type) {
                                    typeName = attrs.type;
                                }
                            }

                            if (typeName && (typeName.prototype instanceof cc.Component || typeName === cc.Component)) {

                                // 这是一个组件属性
                                const targetComp = targetNode.getComponent(typeName);
                                if (targetComp) {
                                    finalValue = targetComp;
                                    Editor.log(`[scene-script] Auto-resolved component ${typeName.name} from node ${targetNode.name}`);
                                } else {
                                    Editor.warn(`[scene-script] Component ${typeName.name} not found on node ${targetNode.name}`);
                                }
                            } else if (!typeName) {
                                // 无法确切知道类型，尝试常见的组件类型推断 (heuristic)
                                const lowerKey = key.toLowerCase();
                                if (lowerKey.includes('label')) {
                                    const l = targetNode.getComponent(cc.Label);
                                    if (l) finalValue = l;
                                } else if (lowerKey.includes('sprite')) {
                                    const s = targetNode.getComponent(cc.Sprite);
                                    if (s) finalValue = s;
                                }
                            }
                        }
                    } catch (e) {
                        // Ignore type check errors
                    }

                    component[key] = finalValue;
                }
            }
        };


        if (!node) {
            if (event.reply) event.reply(new Error("Node not found"));
            return;
        }

        switch (action) {
            case "add":
                if (!componentType) {
                    if (event.reply) event.reply(new Error("Component type is required"));
                    return;
                }

                try {
                    // 解析组件类型
                    let compClass = null;
                    if (componentType.startsWith("cc.")) {
                        const className = componentType.replace("cc.", "");
                        compClass = cc[className];
                    } else {
                        // 尝试获取自定义组件
                        compClass = cc.js.getClassByName(componentType);
                    }

                    if (!compClass) {
                        if (event.reply) event.reply(new Error(`Component type not found: ${componentType}`));
                        return;
                    }

                    // 添加组件
                    const component = node.addComponent(compClass);

                    // 设置属性
                    if (properties) {
                        applyProperties(component, properties);
                    }

                    Editor.Ipc.sendToMain("scene:dirty");
                    Editor.Ipc.sendToAll("scene:node-changed", { uuid: nodeId });

                    if (event.reply) event.reply(null, `Component ${componentType} added`);
                } catch (err) {
                    if (event.reply) event.reply(new Error(`Failed to add component: ${err.message}`));
                }
                break;

            case "remove":
                if (!componentId) {
                    if (event.reply) event.reply(new Error("Component ID is required"));
                    return;
                }

                try {
                    // 查找并移除组件
                    let component = null;
                    if (node._components) {
                        for (let i = 0; i < node._components.length; i++) {
                            if (node._components[i].uuid === componentId) {
                                component = node._components[i];
                                break;
                            }
                        }
                    }

                    if (component) {
                        node.removeComponent(component);
                        Editor.Ipc.sendToMain("scene:dirty");
                        Editor.Ipc.sendToAll("scene:node-changed", { uuid: nodeId });
                        if (event.reply) event.reply(null, "Component removed");
                    } else {
                        if (event.reply) event.reply(new Error("Component not found"));
                    }
                } catch (err) {
                    if (event.reply) event.reply(new Error(`Failed to remove component: ${err.message}`));
                }
                break;

            case "update":
                // 更新现有组件属性
                if (!componentType) {
                    // 如果提供了 componentId，可以只用 componentId
                    // 但 Cocos 2.4 uuid 获取组件比较麻烦，最好还是有 type 或者遍历
                }

                try {
                    let targetComp = null;

                    // 1. 尝试通过 componentId 查找
                    if (componentId) {
                        if (node._components) {
                            for (let i = 0; i < node._components.length; i++) {
                                if (node._components[i].uuid === componentId) {
                                    targetComp = node._components[i];
                                    break;
                                }
                            }
                        }
                    }

                    // 2. 尝试通过 type 查找
                    if (!targetComp && componentType) {
                        let compClass = null;
                        if (componentType.startsWith("cc.")) {
                            const className = componentType.replace("cc.", "");
                            compClass = cc[className];
                        } else {
                            compClass = cc.js.getClassByName(componentType);
                        }
                        if (compClass) {
                            targetComp = node.getComponent(compClass);
                        }
                    }

                    if (targetComp) {
                        if (properties) {
                            applyProperties(targetComp, properties);

                            Editor.Ipc.sendToMain("scene:dirty");
                            Editor.Ipc.sendToAll("scene:node-changed", { uuid: nodeId });
                            if (event.reply) event.reply(null, "Component properties updated");
                        } else {
                            if (event.reply) event.reply(null, "No properties to update");
                        }
                    } else {
                        if (event.reply) event.reply(new Error(`Component not found (Type: ${componentType}, ID: ${componentId})`));
                    }
                } catch (err) {
                    if (event.reply) event.reply(new Error(`Failed to update component: ${err.message}`));
                }
                break;

            case "get":
                try {
                    const components = node._components.map((c) => {
                        // 获取组件属性
                        const properties = {};
                        for (const key in c) {
                            if (typeof c[key] !== "function" && !key.startsWith("_") && c[key] !== undefined) {
                                try {
                                    // Safe serialization check
                                    const val = c[key];
                                    if (val === null || val === undefined) {
                                        properties[key] = val;
                                        continue;
                                    }

                                    // Primitives are safe
                                    if (typeof val !== 'object') {
                                        properties[key] = val;
                                        continue;
                                    }

                                    // Special Cocos Types
                                    if (val instanceof cc.ValueType) {
                                        properties[key] = val.toString();
                                    } else if (val instanceof cc.Asset) {
                                        properties[key] = `Asset(${val.name})`;
                                    } else if (val instanceof cc.Node) {
                                        properties[key] = `Node(${val.name})`;
                                    } else if (val instanceof cc.Component) {
                                        properties[key] = `Component(${val.name}<${val.__typename}>)`;
                                    } else {
                                        // Arrays and Plain Objects
                                        // Attempt to strip to pure JSON data to avoid IPC errors with Native/Circular objects
                                        try {
                                            const jsonStr = JSON.stringify(val);
                                            // Ensure we don't pass the original object reference
                                            properties[key] = JSON.parse(jsonStr);
                                        } catch (e) {
                                            // If JSON fails (e.g. circular), format as string
                                            properties[key] = `[Complex Object: ${val.constructor ? val.constructor.name : typeof val}]`;
                                        }
                                    }
                                } catch (e) {
                                    properties[key] = "[Serialization Error]";
                                }
                            }
                        }
                        return {
                            type: cc.js.getClassName(c) || c.constructor.name || "Unknown",
                            uuid: c.uuid,
                            properties: properties,
                        };
                    });
                    if (event.reply) event.reply(null, components);
                } catch (err) {
                    if (event.reply) event.reply(new Error(`Failed to get components: ${err.message}`));
                }
                break;

            default:
                if (event.reply) event.reply(new Error(`Unknown component action: ${action}`));
                break;
        }
    },

    "get-component-properties": function (component) {
        const properties = {};

        // 遍历组件属性
        for (const key in component) {
            if (typeof component[key] !== "function" && !key.startsWith("_") && component[key] !== undefined) {
                try {
                    properties[key] = component[key];
                } catch (e) {
                    // 忽略无法序列化的属性
                }
            }
        }

        return properties;
    },

    "instantiate-prefab": function (event, args) {
        const { prefabUuid, parentId } = args;
        const scene = cc.director.getScene();

        if (!scene) {
            if (event.reply) event.reply(new Error("Scene not ready or loading."));
            return;
        }

        if (!prefabUuid) {
            if (event.reply) event.reply(new Error("Prefab UUID is required."));
            return;
        }

        // 使用 cc.assetManager.loadAny 通过 UUID 加载 (Cocos 2.4+)
        // 如果是旧版，可能需要 cc.loader.load({uuid: ...})，但在 2.4 环境下 assetManager 更推荐
        cc.assetManager.loadAny(prefabUuid, (err, prefab) => {
            if (err) {
                if (event.reply) event.reply(new Error(`Failed to load prefab: ${err.message}`));
                return;
            }

            // 实例化预制体
            const instance = cc.instantiate(prefab);
            if (!instance) {
                if (event.reply) event.reply(new Error("Failed to instantiate prefab"));
                return;
            }

            // 设置父节点
            let parent = parentId ? cc.engine.getInstanceById(parentId) : scene;
            if (parent) {
                instance.parent = parent;

                // 通知场景变脏
                Editor.Ipc.sendToMain("scene:dirty");

                // 通知 UI 刷新
                setTimeout(() => {
                    Editor.Ipc.sendToAll("scene:node-created", {
                        uuid: instance.uuid,
                        parentUuid: parent.uuid,
                    });
                }, 10);

                if (event.reply) event.reply(null, `Prefab instantiated successfully with UUID: ${instance.uuid}`);
            } else {
                if (event.reply) event.reply(new Error("Parent node not found"));
            }
        });
    },

    "find-gameobjects": function (event, args) {
        const { conditions, recursive = true } = args;
        const result = [];
        const scene = cc.director.getScene();

        function searchNode(node) {
            // 跳过编辑器内部的私有节点
            if (node.name.startsWith("Editor Scene") || node.name === "gizmoRoot") {
                return;
            }

            // 检查节点是否满足条件
            let match = true;

            if (conditions.name && !node.name.includes(conditions.name)) {
                match = false;
            }

            if (conditions.component) {
                let hasComponent = false;
                try {
                    if (conditions.component.startsWith("cc.")) {
                        const className = conditions.component.replace("cc.", "");
                        hasComponent = node.getComponent(cc[className]) !== null;
                    } else {
                        hasComponent = node.getComponent(conditions.component) !== null;
                    }
                } catch (e) {
                    hasComponent = false;
                }
                if (!hasComponent) {
                    match = false;
                }
            }

            if (conditions.active !== undefined && node.active !== conditions.active) {
                match = false;
            }

            if (match) {
                result.push({
                    uuid: node.uuid,
                    name: node.name,
                    active: node.active,
                    position: { x: node.x, y: node.y },
                    scale: { x: node.scaleX, y: node.scaleY },
                    size: { width: node.width, height: node.height },
                    components: node._components.map((c) => c.__typename),
                });
            }

            // 递归搜索子节点
            if (recursive) {
                for (let i = 0; i < node.childrenCount; i++) {
                    searchNode(node.children[i]);
                }
            }
        }

        // 从场景根节点开始搜索
        if (scene) {
            searchNode(scene);
        }

        if (event.reply) {
            event.reply(null, result);
        }
    },

    "manage-vfx": function (event, args) {
        const { action, nodeId, properties, name, parentId } = args;
        const scene = cc.director.getScene();

        const applyParticleProperties = (particleSystem, props) => {
            if (!props) return;

            if (props.duration !== undefined) particleSystem.duration = props.duration;
            if (props.emissionRate !== undefined) particleSystem.emissionRate = props.emissionRate;
            if (props.life !== undefined) particleSystem.life = props.life;
            if (props.lifeVar !== undefined) particleSystem.lifeVar = props.lifeVar;

            // 【关键修复】启用自定义属性，否则属性修改可能不生效
            particleSystem.custom = true;

            if (props.startColor) particleSystem.startColor = new cc.Color().fromHEX(props.startColor);
            if (props.endColor) particleSystem.endColor = new cc.Color().fromHEX(props.endColor);

            if (props.startSize !== undefined) particleSystem.startSize = props.startSize;
            if (props.endSize !== undefined) particleSystem.endSize = props.endSize;

            if (props.speed !== undefined) particleSystem.speed = props.speed;
            if (props.angle !== undefined) particleSystem.angle = props.angle;

            if (props.gravity) {
                if (props.gravity.x !== undefined) particleSystem.gravity.x = props.gravity.x;
                if (props.gravity.y !== undefined) particleSystem.gravity.y = props.gravity.y;
            }

            // 处理文件/纹理加载
            if (props.file) {
                // main.js 已经将 db:// 路径转换为 UUID
                // 如果用户直接传递 URL (http/https) 或其他格式，cc.assetManager.loadAny 也能处理
                const uuid = props.file;
                cc.assetManager.loadAny(uuid, (err, asset) => {
                    if (!err) {
                        if (asset instanceof cc.ParticleAsset) {
                            particleSystem.file = asset;
                        } else if (asset instanceof cc.Texture2D || asset instanceof cc.SpriteFrame) {
                            particleSystem.texture = asset;
                        }
                        Editor.Ipc.sendToMain("scene:dirty");
                    }
                });
            } else if (!particleSystem.texture && !particleSystem.file && args.defaultSpriteUuid) {
                // 【关键修复】如果没有纹理，加载默认纹理 (UUID 由 main.js 传入)
                Editor.log(`[mcp-bridge] Loading default texture with UUID: ${args.defaultSpriteUuid}`);
                cc.assetManager.loadAny(args.defaultSpriteUuid, (err, asset) => {
                    if (err) {
                        Editor.error(`[mcp-bridge] Failed to load default texture: ${err.message}`);
                    } else if (asset instanceof cc.Texture2D || asset instanceof cc.SpriteFrame) {
                        Editor.log(`[mcp-bridge] Default texture loaded successfully.`);
                        particleSystem.texture = asset;
                        Editor.Ipc.sendToMain("scene:dirty");
                    } else {
                        Editor.warn(`[mcp-bridge] Loaded asset is not a texture: ${asset}`);
                    }
                });
            }
        };

        if (action === "create") {
            let newNode = new cc.Node(name || "New Particle");
            let particleSystem = newNode.addComponent(cc.ParticleSystem);

            // 设置默认值
            particleSystem.resetSystem();
            particleSystem.custom = true; // 确保新创建的也是 custom 模式

            applyParticleProperties(particleSystem, properties);

            let parent = parentId ? cc.engine.getInstanceById(parentId) : scene;
            if (parent) {
                newNode.parent = parent;
                Editor.Ipc.sendToMain("scene:dirty");
                setTimeout(() => {
                    Editor.Ipc.sendToAll("scene:node-created", {
                        uuid: newNode.uuid,
                        parentUuid: parent.uuid,
                    });
                }, 10);
                if (event.reply) event.reply(null, newNode.uuid);
            } else {
                if (event.reply) event.reply(new Error("Parent node not found"));
            }

        } else if (action === "update") {
            let node = cc.engine.getInstanceById(nodeId);
            if (node) {
                let particleSystem = node.getComponent(cc.ParticleSystem);
                if (!particleSystem) {
                    // 如果没有组件，自动添加
                    particleSystem = node.addComponent(cc.ParticleSystem);
                }

                applyParticleProperties(particleSystem, properties);

                Editor.Ipc.sendToMain("scene:dirty");
                Editor.Ipc.sendToAll("scene:node-changed", { uuid: nodeId });
                if (event.reply) event.reply(null, "VFX updated");
            } else {
                if (event.reply) event.reply(new Error("Node not found"));
            }

        } else if (action === "get_info") {
            let node = cc.engine.getInstanceById(nodeId);
            if (node) {
                let ps = node.getComponent(cc.ParticleSystem);
                if (ps) {
                    const info = {
                        duration: ps.duration,
                        emissionRate: ps.emissionRate,
                        life: ps.life,
                        lifeVar: ps.lifeVar,
                        startColor: ps.startColor.toHEX("#RRGGBB"),
                        endColor: ps.endColor.toHEX("#RRGGBB"),
                        startSize: ps.startSize,
                        endSize: ps.endSize,
                        speed: ps.speed,
                        angle: ps.angle,
                        gravity: { x: ps.gravity.x, y: ps.gravity.y },
                        file: ps.file ? ps.file.name : null
                    };
                    if (event.reply) event.reply(null, info);
                } else {
                    if (event.reply) event.reply(null, { hasParticleSystem: false });
                }
            } else {
                if (event.reply) event.reply(new Error("Node not found"));
            }
        } else {
            if (event.reply) event.reply(new Error(`Unknown VFX action: ${action}`));
        }
    },
};

"use strict";

/**
 * 更加健壮的节点查找函数，支持解压后的 UUID
 * @param {string} id 节点的 UUID (支持 22 位压缩格式)
 * @returns {cc.Node | null} 找到的节点对象或 null
 */
const findNode = (id) => {
    if (!id) return null;
    let node = cc.engine.getInstanceById(id);
    if (!node && typeof Editor !== "undefined" && Editor.Utils && Editor.Utils.UuidUtils) {
        // 如果直接查不到，尝试对可能是压缩格式的 ID 进行解压后再次查找
        try {
            const decompressed = Editor.Utils.UuidUtils.decompressUuid(id);
            if (decompressed !== id) {
                node = cc.engine.getInstanceById(decompressed);
            }
        } catch (e) {
            // 忽略转换错误
        }
    }
    return node;
};

module.exports = {
    /**
     * 修改节点的基础属性
     * @param {Object} event IPC 事件对象
     * @param {Object} args 参数 (id, path, value)
     */
    "set-property": function (event, args) {
        const { id, path, value } = args;

        // 1. 获取节点
        let node = findNode(id);

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
                event.reply(null, `节点 ${id} 已更新为 ${value}`);
            }
        } else {
            if (event.reply) {
                event.reply(new Error("场景脚本：找不到节点 " + id));
            }
        }
    },
    /**
     * 获取当前场景的完整层级树
     * @param {Object} event IPC 事件对象
     * @param {Object} args 参数 (nodeId, depth, includeDetails)
     */
    "get-hierarchy": function (event, args) {
        const { nodeId = null, depth = 2, includeDetails = false } = args || {};
        const scene = cc.director.getScene();

        let rootNode = scene;
        if (nodeId) {
            rootNode = findNode(nodeId);
            if (!rootNode) {
                if (event.reply) event.reply(new Error(`找不到指定的起始节点: ${nodeId}`));
                return;
            }
        }

        /**
         * 递归遍历并序列化节点树
         * @param {cc.Node} node 目标节点
         * @param {number} currentDepth 当前深度
         * @returns {Object|null} 序列化后的节点数据
         */
        function dumpNodes(node, currentDepth) {
            // 【优化】跳过编辑器内部的私有节点，减少数据量
            if (
                !node ||
                !node.name ||
                (typeof node.name === "string" && (node.name.startsWith("Editor Scene") || node.name === "gizmoRoot"))
            ) {
                return null;
            }

            let nodeData = {
                name: node.name,
                uuid: node.uuid,
                childrenCount: node.childrenCount,
            };

            const comps = node._components || [];

            // 根据是否需要详情来决定附加哪些数据以节省 Token
            if (includeDetails) {
                nodeData.active = node.active;
                nodeData.position = { x: Math.round(node.x), y: Math.round(node.y) };
                nodeData.scale = { x: node.scaleX, y: node.scaleY };
                nodeData.size = { width: node.width, height: node.height };
                nodeData.components = comps.map((c) => cc.js.getClassName(c));
            } else {
                // 简略模式下如果存在组件，至少提供一个极简列表让 AI 知道节点的作用
                if (comps.length > 0) {
                    nodeData.components = comps.map((c) => {
                        const parts = (cc.js.getClassName(c) || "").split(".");
                        return parts[parts.length - 1]; // 只取类名，例如 cc.Sprite -> Sprite
                    });
                }
            }

            // 如果未超出深度限制，继续递归子树
            if (currentDepth < depth && node.childrenCount > 0) {
                nodeData.children = [];
                for (let i = 0; i < node.childrenCount; i++) {
                    let childData = dumpNodes(node.children[i], currentDepth + 1);
                    if (childData) nodeData.children.push(childData);
                }
            }

            return nodeData;
        }

        const hierarchy = dumpNodes(rootNode, 0);
        if (event.reply) event.reply(null, hierarchy);
    },

    /**
     * 批量更新节点的变换信息 (坐标、缩放、颜色)
     * @param {Object} event IPC 事件对象
     * @param {Object} args 参数 (id, x, y, scaleX, scaleY, color)
     */
    "update-node-transform": function (event, args) {
        const { id, x, y, scaleX, scaleY, color } = args;

        let node = findNode(id);

        if (node) {
            // 使用 scene:set-property 实现支持 Undo 的属性修改
            // 注意：IPC 消息需要发送到 'scene' 面板
            if (x !== undefined) {
                Editor.Ipc.sendToPanel("scene", "scene:set-property", {
                    id,
                    path: "x",
                    type: "Number",
                    value: Number(x),
                });
            }
            if (y !== undefined) {
                Editor.Ipc.sendToPanel("scene", "scene:set-property", {
                    id,
                    path: "y",
                    type: "Number",
                    value: Number(y),
                });
            }
            if (args.width !== undefined) {
                Editor.Ipc.sendToPanel("scene", "scene:set-property", {
                    id,
                    path: "width",
                    type: "Number",
                    value: Number(args.width),
                });
            }
            if (args.height !== undefined) {
                Editor.Ipc.sendToPanel("scene", "scene:set-property", {
                    id,
                    path: "height",
                    type: "Number",
                    value: Number(args.height),
                });
            }
            if (scaleX !== undefined) {
                Editor.Ipc.sendToPanel("scene", "scene:set-property", {
                    id,
                    path: "scaleX",
                    type: "Number",
                    value: Number(scaleX),
                });
            }
            if (scaleY !== undefined) {
                Editor.Ipc.sendToPanel("scene", "scene:set-property", {
                    id,
                    path: "scaleY",
                    type: "Number",
                    value: Number(scaleY),
                });
            }
            if (color) {
                const c = new cc.Color().fromHEX(color);
                Editor.Ipc.sendToPanel("scene", "scene:set-property", {
                    id: id,
                    path: "color",
                    type: "Color",
                    value: { r: c.r, g: c.g, b: c.b, a: c.a },
                });
            }

            Editor.Ipc.sendToMain("scene:dirty");
            Editor.Ipc.sendToAll("scene:node-changed", { uuid: id });

            if (event.reply) event.reply(null, "变换信息已更新");
        } else {
            if (event.reply) event.reply(new Error("找不到节点"));
        }
    },
    /**
     * 在场景中创建新节点
     * @param {Object} event IPC 事件对象
     * @param {Object} args 参数 (name, parentId, type)
     */
    "create-node": function (event, args) {
        const { name, parentId, type } = args;
        const scene = cc.director.getScene();
        if (!scene) {
            if (event.reply) event.reply(new Error("场景尚未准备好或正在加载。"));
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
            newNode = new cc.Node(name || "新建精灵节点");
            let sprite = newNode.addComponent(cc.Sprite);
            // 设置为 CUSTOM 模式
            sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            // 为精灵设置默认尺寸
            newNode.width = 100;
            newNode.height = 100;

            // 加载引擎默认图做占位
            if (args.defaultSpriteUuid) {
                cc.assetManager.loadAny(args.defaultSpriteUuid, (err, asset) => {
                    if (!err && (asset instanceof cc.SpriteFrame || asset instanceof cc.Texture2D)) {
                        sprite.spriteFrame = asset instanceof cc.SpriteFrame ? asset : new cc.SpriteFrame(asset);
                        Editor.Ipc.sendToMain("scene:dirty");
                    }
                });
            }
        } else if (type === "button") {
            newNode = new cc.Node(name || "新建按钮节点");
            let sprite = newNode.addComponent(cc.Sprite);
            newNode.addComponent(cc.Button);

            // 设置为 CUSTOM 模式并应用按钮专用尺寸
            sprite.sizeMode = cc.Sprite.SizeMode.CUSTOM;
            newNode.width = 150;
            newNode.height = 50;

            // 设置稍暗的背景颜色 (#A0A0A0)，以便于看清其上的文字
            newNode.color = new cc.Color(160, 160, 160);

            // 加载引擎默认图
            if (args.defaultSpriteUuid) {
                cc.assetManager.loadAny(args.defaultSpriteUuid, (err, asset) => {
                    if (!err && (asset instanceof cc.SpriteFrame || asset instanceof cc.Texture2D)) {
                        sprite.spriteFrame = asset instanceof cc.SpriteFrame ? asset : new cc.SpriteFrame(asset);
                        Editor.Ipc.sendToMain("scene:dirty");
                    }
                });
            }
        } else if (type === "label") {
            newNode = new cc.Node(name || "新建文本节点");
            let l = newNode.addComponent(cc.Label);
            l.string = "新文本";
            newNode.width = 120;
            newNode.height = 40;
        } else {
            newNode = new cc.Node(name || "新建节点");
        }

        // 设置层级
        let parent = parentId ? findNode(parentId) : scene;
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
        } else {
            if (event.reply) event.reply(new Error(`无法创建节点：找不到父节点 ${parentId}`));
        }
    },

    /**
     * 管理节点上的组件 (添加、移除、更新属性)
     * @param {Object} event IPC 事件对象
     * @param {Object} args 参数 (nodeId, action, componentType, componentId, properties)
     */
    "manage-components": function (event, args) {
        let { nodeId, action, operation, componentType, componentId, properties } = args;
        // 兼容 AI 幻觉带来的传参错误
        action = action || operation;

        let node = findNode(nodeId);

        /**
         * 辅助函数：应用属性并智能解析 (支持 UUID 资源与节点引用)
         * @param {cc.Component} component 目标组件实例
         * @param {Object} props 待更新的属性键值对
         */
        const applyProperties = (component, props) => {
            if (!props) return;
            // 尝试获取组件类的属性定义
            const compClass = component.constructor;

            for (const [key, value] of Object.entries(props)) {
                // 【防呆设计】拦截对核心只读属性的非法重写
                // 如果直接修改组件的 node 属性，会导致该引用丢失变成普通对象，进而引发编辑器卡死
                if (key === "node" || key === "uuid" || key === "_id") {
                    Editor.warn(
                        `[scene-script] 拒绝覆盖组件的只读/核心属性: ${key}。请勿对组件执行此操作，修改位置/激活状态等请操作 Node 节点！`,
                    );
                    continue;
                }

                // 【核心修复】专门处理各类事件属性 (ClickEvents, ScrollEvents 等)
                const isEventProp =
                    Array.isArray(value) && (key.toLowerCase().endsWith("events") || key === "clickEvents");

                if (isEventProp) {
                    const eventHandlers = [];
                    for (const item of value) {
                        if (typeof item === "object" && (item.target || item.component || item.handler)) {
                            const handler = new cc.Component.EventHandler();

                            // 解析 Target Node
                            if (item.target) {
                                let targetNode = findNode(item.target);
                                if (!targetNode && item.target instanceof cc.Node) {
                                    targetNode = item.target;
                                }

                                if (targetNode) {
                                    handler.target = targetNode;
                                }
                            }

                            if (item.component) handler.component = item.component;
                            if (item.handler) handler.handler = item.handler;
                            if (item.customEventData !== undefined)
                                handler.customEventData = String(item.customEventData);

                            eventHandlers.push(handler);
                        } else {
                            // 如果不是对象，原样保留
                            eventHandlers.push(item);
                        }
                    }
                    component[key] = eventHandlers;
                    continue; // 处理完事件数组，跳出本次循环
                }

                // 检查属性是否存在
                if (component[key] !== undefined) {
                    let finalValue = value;

                    // 【核心逻辑】智能类型识别与赋值
                    try {
                        const attrs = (cc.Class.Attr.getClassAttrs && cc.Class.Attr.getClassAttrs(compClass)) || {};
                        let propertyType = attrs[key] ? attrs[key].type : null;
                        if (!propertyType && attrs[key + "$_$ctor"]) {
                            propertyType = attrs[key + "$_$ctor"];
                        }

                        let isAsset =
                            propertyType &&
                            (propertyType.prototype instanceof cc.Asset ||
                                propertyType === cc.Asset ||
                                propertyType === cc.Prefab ||
                                propertyType === cc.SpriteFrame);
                        let isAssetArray =
                            Array.isArray(value) && (key === "materials" || key.toLowerCase().includes("assets"));

                        // 启发式：如果属性名包含 prefab/sprite/texture 等，且值为 UUID 且不是节点
                        if (!isAsset && !isAssetArray && typeof value === "string" && value.length > 20) {
                            const lowerKey = key.toLowerCase();
                            const assetKeywords = [
                                "prefab",
                                "sprite",
                                "texture",
                                "material",
                                "skeleton",
                                "spine",
                                "atlas",
                                "font",
                                "audio",
                                "data",
                            ];
                            if (assetKeywords.some((k) => lowerKey.includes(k))) {
                                if (!findNode(value)) {
                                    isAsset = true;
                                }
                            }
                        }

                        if (isAsset || isAssetArray) {
                            // 1. 处理资源引用 (单个或数组)
                            const uuids = isAssetArray ? value : [value];
                            const loadedAssets = [];
                            let loadedCount = 0;

                            if (uuids.length === 0) {
                                component[key] = [];
                                return;
                            }

                            const fs = require("fs");
                            const path = require("path");

                            uuids.forEach((uuid, idx) => {
                                if (typeof uuid !== "string" || uuid.length < 10) {
                                    loadedCount++;
                                    return;
                                }

                                // 尝试进行自动转换：如果这是原图，且需要 SpriteFrame，自动读取其 meta 获取子 UUID
                                const needsSpriteFrame =
                                    propertyType === cc.SpriteFrame || key.toLowerCase().includes("sprite");

                                let targetUuid = uuid;

                                if (needsSpriteFrame && Editor && Editor.assetdb && Editor.assetdb.remote) {
                                    try {
                                        const fspath = Editor.assetdb.remote.uuidToFspath(uuid);
                                        if (fspath) {
                                            const metaPath = fspath + ".meta";
                                            if (fs.existsSync(metaPath)) {
                                                const metaContent = fs.readFileSync(metaPath, "utf-8");
                                                const metaObj = JSON.parse(metaContent);
                                                // Creator 2.x 图片的 subMetas 里通常存储着以图片名命名的 spriteFrame
                                                if (metaObj && metaObj.subMetas) {
                                                    const subKeys = Object.keys(metaObj.subMetas);
                                                    // 如果有子 spriteFrame，提取它的 uuid
                                                    for (const subKey of subKeys) {
                                                        const subMeta = metaObj.subMetas[subKey];
                                                        if (subMeta && (subMeta.uuid || subMeta.rawTextureUuid)) {
                                                            targetUuid = subMeta.uuid;
                                                            Editor.log(
                                                                `[scene-script] 自动转换 UUID: ${uuid} (Texture2D) -> ${targetUuid} (SpriteFrame)`,
                                                            );
                                                            break;
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    } catch (err) {
                                        Editor.log(`[scene-script] 读取 meta 失败: ${err.message}`);
                                    }
                                }

                                cc.AssetLibrary.loadAsset(targetUuid, (err, asset) => {
                                    loadedCount++;
                                    if (!err && asset) {
                                        // 判断是否依然是 Texture2D，并且需要 SpriteFrame
                                        const stillIsTexture = asset instanceof cc.Texture2D && needsSpriteFrame;

                                        if (stillIsTexture) {
                                            Editor.warn(
                                                `[scene-script] 拒绝为 ${key}[${idx}] 赋值：给 SpriteFrame 属性传递了 Texture2D (原图) 的 UUID ${targetUuid}。自动转换失败，请使用正确的 SpriteFrame UUID。`,
                                            );
                                        } else {
                                            loadedAssets[idx] = asset;
                                        }
                                    } else {
                                        Editor.warn(
                                            `[scene-script] 未能为 ${key}[${idx}] 加载资源 ${targetUuid}: ${err}`,
                                        );
                                    }

                                    if (loadedCount === uuids.length) {
                                        if (isAssetArray) {
                                            // 过滤掉加载失败的
                                            component[key] = loadedAssets.filter((a) => !!a);
                                        } else {
                                            if (loadedAssets[0]) component[key] = loadedAssets[0];
                                        }

                                        // 通知编辑器 UI 更新
                                        const compIndex = node._components.indexOf(component);
                                        if (compIndex !== -1) {
                                            Editor.Ipc.sendToPanel("scene", "scene:set-property", {
                                                id: node.uuid,
                                                path: `_components.${compIndex}.${key}`,
                                                type: isAssetArray ? "Array" : "Object",
                                                value: isAssetArray ? uuids.map((u) => ({ uuid: u })) : { uuid: value },
                                                isSubProp: false,
                                            });
                                        }
                                        Editor.Ipc.sendToMain("scene:dirty");
                                    }
                                });
                            });
                            // 【重要修复】使用 continue 而不是 return，确保处理完 Asset 属性后
                            // 还能继续处理后续的普通属性 (如 type, sizeMode 等)
                            continue;
                        } else if (
                            propertyType &&
                            (propertyType.prototype instanceof cc.Component ||
                                propertyType === cc.Component ||
                                propertyType === cc.Node)
                        ) {
                            // 2. 处理节点或组件引用
                            const targetNode = findNode(value);
                            if (targetNode) {
                                if (propertyType === cc.Node) {
                                    finalValue = targetNode;
                                } else {
                                    const targetComp = targetNode.getComponent(propertyType);
                                    if (targetComp) {
                                        finalValue = targetComp;
                                    } else {
                                        Editor.warn(
                                            `[scene-script] 在节点 ${targetNode.name} 上找不到组件 ${propertyType.name}`,
                                        );
                                    }
                                }
                            } else if (value && value.length > 20) {
                                // 如果明确是组件/节点类型但找不到，才报错
                                Editor.warn(`[scene-script] 无法解析 ${key} 的目标节点/组件: ${value}`);
                            }
                        } else {
                            // 3. 通用启发式 (找不到类型时的 fallback)
                            if (typeof value === "string" && value.length > 20) {
                                const targetNode = findNode(value);
                                if (targetNode) {
                                    finalValue = targetNode;
                                } else {
                                    // 找不到节点且是 UUID -> 视为资源
                                    const compIndex = node._components.indexOf(component);
                                    if (compIndex !== -1) {
                                        Editor.Ipc.sendToPanel("scene", "scene:set-property", {
                                            id: node.uuid,
                                            path: `_components.${compIndex}.${key}`,
                                            type: "Object",
                                            value: { uuid: value },
                                            isSubProp: false,
                                        });
                                    }
                                    continue;
                                }
                            }
                        }
                    } catch (e) {
                        Editor.warn(`[scene-script] 解析属性 ${key} 失败: ${e.message}`);
                    }

                    component[key] = finalValue;
                }
            }
        };

        if (!node) {
            if (event.reply) event.reply(new Error("找不到节点"));
            return;
        }

        switch (action) {
            case "add":
                if (!componentType) {
                    if (event.reply) event.reply(new Error("必须提供组件类型"));
                    return;
                }

                // 【防呆设计】拦截 AI 错误地将 cc.Node 作为组件添加
                if (componentType === "cc.Node" || componentType === "Node") {
                    if (event.reply) {
                        event.reply(
                            new Error(
                                "【纠错提示】cc.Node 是节点而不是组件，无法被当做组件添加！\n" +
                                    "- 如果你想创建带有名字的子节点，请不要使用 manage_components，而是使用 create-node (或相应的创建节点工具)。\n" +
                                    "- 如果你想修改现有节点的 name 属性，请使用修改节点的 set-property 工具。",
                            ),
                        );
                    }
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
                        if (event.reply) event.reply(new Error(`找不到组件类型: ${componentType}`));
                        return;
                    }

                    // 【防呆设计】确保获取到的类是一个组件
                    if (!cc.js.isChildClassOf(compClass, cc.Component)) {
                        if (event.reply) {
                            event.reply(
                                new Error(
                                    `【错误】'${componentType}' 不是一个合法的组件类型（必须继承自 cc.Component）。请确认你的意图。`,
                                ),
                            );
                        }
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

                    if (event.reply) event.reply(null, `组件 ${componentType} 已添加`);
                } catch (err) {
                    if (event.reply) event.reply(new Error(`添加组件失败: ${err.message}`));
                }
                break;

            case "remove":
                if (!componentId) {
                    if (event.reply) event.reply(new Error("必须提供组件 ID"));
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
                        if (event.reply) event.reply(null, "组件已移除");
                    } else {
                        if (event.reply) event.reply(new Error("找不到组件"));
                    }
                } catch (err) {
                    if (event.reply) event.reply(new Error(`移除组件失败: ${err.message}`));
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
                            if (event.reply) event.reply(null, "组件属性已更新");
                        } else {
                            if (event.reply) event.reply(null, "没有需要更新的属性");
                        }
                    } else {
                        if (event.reply)
                            event.reply(new Error(`找不到组件 (类型: ${componentType}, ID: ${componentId})`));
                    }
                } catch (err) {
                    if (event.reply) event.reply(new Error(`更新组件失败: ${err.message}`));
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
                                    // 安全序列化检查
                                    const val = c[key];
                                    if (val === null || val === undefined) {
                                        properties[key] = val;
                                        continue;
                                    }

                                    // 基础类型是安全的
                                    if (typeof val !== "object") {
                                        // 【优化】对于超长字符串进行截断
                                        if (typeof val === "string" && val.length > 200) {
                                            properties[key] =
                                                val.substring(0, 50) + `...[Truncated, total length: ${val.length}]`;
                                        } else {
                                            properties[key] = val;
                                        }
                                        continue;
                                    }

                                    // 特殊 Cocos 类型
                                    if (val instanceof cc.ValueType) {
                                        properties[key] = val.toString();
                                    } else if (val instanceof cc.Asset) {
                                        properties[key] = `资源(${val.name})`;
                                    } else if (val instanceof cc.Node) {
                                        properties[key] = `节点(${val.name})`;
                                    } else if (val instanceof cc.Component) {
                                        properties[key] = `组件(${val.name}<${val.__typename}>)`;
                                    } else {
                                        // 数组和普通对象
                                        // 【优化】对于超长数组直接截断并提示，防止返回巨大的坐标或点集
                                        if (Array.isArray(val) && val.length > 10) {
                                            properties[key] = `[Array(${val.length})]`;
                                            continue;
                                        }

                                        // 尝试转换为纯 JSON 数据以避免 IPC 错误（如包含原生对象/循环引用）
                                        try {
                                            const jsonStr = JSON.stringify(val);
                                            if (jsonStr && jsonStr.length > 500) {
                                                properties[key] = `[Large JSON Object, length: ${jsonStr.length}]`;
                                            } else {
                                                // 确保不传递原始对象引用
                                                properties[key] = JSON.parse(jsonStr);
                                            }
                                        } catch (e) {
                                            // 如果 JSON 失败（例如循环引用），格式化为字符串
                                            properties[key] =
                                                `[复杂对象: ${val.constructor ? val.constructor.name : typeof val}]`;
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
                    if (event.reply) event.reply(new Error(`获取组件失败: ${err.message}`));
                }
                break;

            default:
                if (event.reply) event.reply(new Error(`未知的组件操作类型: ${action}`));
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
            if (event.reply) event.reply(new Error("场景尚未准备好或正在加载。"));
            return;
        }

        if (!prefabUuid) {
            if (event.reply) event.reply(new Error("必须提供预制体 UUID。"));
            return;
        }

        // 使用 cc.assetManager.loadAny 通过 UUID 加载 (Cocos 2.4+)
        // 如果是旧版，可能需要 cc.loader.load({uuid: ...})，但在 2.4 环境下 assetManager 更推荐
        cc.assetManager.loadAny(prefabUuid, (err, prefab) => {
            if (err) {
                if (event.reply) event.reply(new Error(`加载预制体失败: ${err.message}`));
                return;
            }

            // 实例化预制体
            const instance = cc.instantiate(prefab);
            if (!instance) {
                if (event.reply) event.reply(new Error("实例化预制体失败"));
                return;
            }

            // 设置父节点
            let parent = parentId ? findNode(parentId) : scene;
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

                if (event.reply) event.reply(null, `预制体实例化成功，UUID: ${instance.uuid}`);
            } else {
                if (event.reply) event.reply(new Error("找不到父节点"));
            }
        });
    },

    /**
     * 根据特定条件在场景中搜索节点
     * @param {Object} event IPC 事件对象
     * @param {Object} args 参数 (conditions, recursive)
     */
    "find-gameobjects": function (event, args) {
        const { conditions, recursive = true } = args;
        const result = [];
        const scene = cc.director.getScene();

        function searchNode(node) {
            if (
                !node ||
                !node.name ||
                (typeof node.name === "string" && (node.name.startsWith("Editor Scene") || node.name === "gizmoRoot"))
            ) {
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
                const comps = node._components || [];
                result.push({
                    uuid: node.uuid,
                    name: node.name,
                    active: node.active,
                    components: comps.map((c) => {
                        const parts = (cc.js.getClassName(c) || "").split(".");
                        return parts[parts.length - 1]; // 简化的组件名
                    }),
                    childrenCount: node.childrenCount,
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

    /**
     * 查找场景中引用了指定节点或资源的所有位置
     * @param {Object} event IPC 事件对象
     * @param {Object} args 参数 (targetId, targetType)
     */
    "find-references": function (event, args) {
        const { targetId, targetType = "auto", additionalIds } = args;
        if (!targetId) {
            if (event.reply) event.reply(new Error("必须提供 targetId 参数"));
            return;
        }

        const scene = cc.director.getScene();
        if (!scene) {
            if (event.reply) event.reply(new Error("场景尚未准备好"));
            return;
        }

        // 判断目标类型：尝试先当节点查找
        let detectedType = targetType;
        if (targetType === "auto") {
            const targetNode = findNode(targetId);
            detectedType = targetNode ? "node" : "asset";
        }

        const results = [];

        // 规范化 UUID: 同时生成压缩(22位)和解压(36位)格式，确保资源匹配
        const targetVariants = [targetId];
        try {
            if (typeof Editor !== "undefined" && Editor.Utils && Editor.Utils.UuidUtils) {
                const compressed = Editor.Utils.UuidUtils.compressUuid(targetId);
                const decompressed = Editor.Utils.UuidUtils.decompressUuid(targetId);
                if (compressed && compressed !== targetId) targetVariants.push(compressed);
                if (decompressed && decompressed !== targetId) targetVariants.push(decompressed);
            }
        } catch (e) {
            /* 忽略 UUID 转换错误 */
        }
        // 合并 main.js 预解析的子资源 UUID (如 Texture2D 对应的 SpriteFrame)
        if (Array.isArray(additionalIds)) {
            additionalIds.forEach(function (aid) {
                if (targetVariants.indexOf(aid) === -1) targetVariants.push(aid);
                try {
                    if (typeof Editor !== "undefined" && Editor.Utils && Editor.Utils.UuidUtils) {
                        var c = Editor.Utils.UuidUtils.compressUuid(aid);
                        var d = Editor.Utils.UuidUtils.decompressUuid(aid);
                        if (c && targetVariants.indexOf(c) === -1) targetVariants.push(c);
                        if (d && targetVariants.indexOf(d) === -1) targetVariants.push(d);
                    }
                } catch (e) {
                    /* 忽略 */
                }
            });
        }

        /**
         * 检查一个属性值是否引用了目标
         * @returns {string|null} 匹配时返回可读描述，否则返回 null
         */
        function checkValue(val) {
            if (!val || typeof val !== "object") return null;

            if (detectedType === "node") {
                // 检查节点引用
                if (val instanceof cc.Node && val.uuid === targetId) {
                    return `节点(${val.name})`;
                }
            } else {
                // 检查资源引用 (cc.Asset 的 _uuid 属性)
                if (val instanceof cc.Asset) {
                    var assetUuid = val._uuid || "";
                    for (var vi = 0; vi < targetVariants.length; vi++) {
                        if (assetUuid === targetVariants[vi]) {
                            return `资源(${val.name || assetUuid})`;
                        }
                    }
                }
            }
            return null;
        }

        /**
         * 递归扫描节点及其子节点
         */
        function scanNode(node) {
            if (!node || !node.name) return;
            if (typeof node.name === "string" && (node.name.startsWith("Editor Scene") || node.name === "gizmoRoot")) {
                return;
            }

            // 跳过目标节点自身
            if (detectedType === "node" && node.uuid === targetId) {
                // 不跳过，仍然扫描子节点，但不扫描自身的组件
            } else {
                // 遍历该节点的所有组件
                const comps = node._components || [];
                for (let ci = 0; ci < comps.length; ci++) {
                    const comp = comps[ci];
                    const compTypeName = cc.js.getClassName(comp) || comp.constructor.name || "Unknown";

                    for (const key in comp) {
                        if (typeof comp[key] === "function" || key.startsWith("_")) continue;
                        if (key === "node" || key === "uuid" || key === "name") continue;

                        try {
                            const val = comp[key];
                            if (val === null || val === undefined) continue;

                            // 直接值检查
                            const directMatch = checkValue(val);
                            if (directMatch) {
                                results.push({
                                    nodeId: node.uuid,
                                    nodeName: node.name,
                                    componentType: compTypeName,
                                    componentIndex: ci,
                                    propertyName: key,
                                    propertyValue: directMatch,
                                });
                                continue;
                            }

                            // 数组检查 (如 EventHandler 数组、materials 等)
                            if (Array.isArray(val)) {
                                for (let ai = 0; ai < val.length; ai++) {
                                    const item = val[ai];
                                    const arrMatch = checkValue(item);
                                    if (arrMatch) {
                                        results.push({
                                            nodeId: node.uuid,
                                            nodeName: node.name,
                                            componentType: compTypeName,
                                            componentIndex: ci,
                                            propertyName: `${key}[${ai}]`,
                                            propertyValue: arrMatch,
                                        });
                                    }
                                    // EventHandler 的 target 属性
                                    if (item && item instanceof cc.Component.EventHandler && item.target) {
                                        const ehMatch = checkValue(item.target);
                                        if (ehMatch) {
                                            results.push({
                                                nodeId: node.uuid,
                                                nodeName: node.name,
                                                componentType: compTypeName,
                                                componentIndex: ci,
                                                propertyName: `${key}[${ai}].target`,
                                                propertyValue: ehMatch,
                                            });
                                        }
                                    }
                                }
                            }
                        } catch (e) {
                            // 跳过无法访问的属性
                        }
                    }
                }
            }

            // 递归子节点
            for (let i = 0; i < node.childrenCount; i++) {
                scanNode(node.children[i]);
            }
        }

        scanNode(scene);

        if (event.reply) {
            event.reply(null, {
                targetId: targetId,
                targetType: detectedType,
                referenceCount: results.length,
                references: results,
            });
        }
    },

    /**
     * 删除指定的场景节点
     * @param {Object} event IPC 事件对象
     * @param {Object} args 参数 (uuid)
     */
    "delete-node": function (event, args) {
        const { uuid } = args;
        const node = findNode(uuid);
        if (node) {
            const parent = node.parent;
            node.destroy();
            Editor.Ipc.sendToMain("scene:dirty");
            // 延迟通知以确保节点已被移除
            setTimeout(() => {
                if (parent) {
                    Editor.Ipc.sendToAll("scene:node-changed", { uuid: parent.uuid });
                }
                // 广播节点删除事件
                Editor.Ipc.sendToAll("scene:node-deleted", { uuid: uuid });
            }, 10);

            if (event.reply) event.reply(null, `节点 ${uuid} 已删除`);
        } else {
            if (event.reply) event.reply(new Error(`找不到节点: ${uuid}`));
        }
    },

    /**
     * 管理高效的全场景特效 (粒子系统)
     * @param {Object} event IPC 事件对象
     * @param {Object} args 参数 (action, nodeId, properties, name, parentId)
     */
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
                if (event.reply) event.reply(new Error("找不到父节点"));
            }
        } else if (action === "update") {
            let node = findNode(nodeId);
            if (node) {
                let particleSystem = node.getComponent(cc.ParticleSystem);
                if (!particleSystem) {
                    // 如果没有组件，自动添加
                    particleSystem = node.addComponent(cc.ParticleSystem);
                }

                applyParticleProperties(particleSystem, properties);

                Editor.Ipc.sendToMain("scene:dirty");
                Editor.Ipc.sendToAll("scene:node-changed", { uuid: nodeId });
                if (event.reply) event.reply(null, "特效已更新");
            } else {
                if (event.reply) event.reply(new Error("找不到节点"));
            }
        } else if (action === "get_info") {
            let node = findNode(nodeId);
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
                        file: ps.file ? ps.file.name : null,
                    };
                    if (event.reply) event.reply(null, info);
                } else {
                    if (event.reply) event.reply(null, { hasParticleSystem: false });
                }
            } else {
                if (event.reply) event.reply(new Error("找不到节点"));
            }
        } else {
            if (event.reply) event.reply(new Error(`未知的特效操作类型: ${action}`));
        }
    },

    /**
     * 控制节点的动画组件 (播放、暂停、停止等)
     * @param {Object} event IPC 事件对象
     * @param {Object} args 参数 (action, nodeId, clipName)
     */
    "manage-animation": function (event, args) {
        const { action, nodeId, clipName } = args;
        const node = findNode(nodeId);

        if (!node) {
            if (event.reply) event.reply(new Error(`找不到节点: ${nodeId}`));
            return;
        }

        const anim = node.getComponent(cc.Animation);
        if (!anim) {
            if (event.reply) event.reply(new Error(`在节点 ${nodeId} 上找不到 Animation 组件`));
            return;
        }

        switch (action) {
            case "get_list":
                const clips = anim.getClips();
                const clipList = clips.map((c) => ({
                    name: c.name,
                    duration: c.duration,
                    sample: c.sample,
                    speed: c.speed,
                    wrapMode: c.wrapMode,
                }));
                if (event.reply) event.reply(null, clipList);
                break;

            case "get_info":
                const currentClip = anim.currentClip;
                let isPlaying = false;
                // [安全修复] 只有在有当前 Clip 时才获取状态，避免 Animation 组件无 Clip 时的崩溃
                if (currentClip) {
                    const state = anim.getAnimationState(currentClip.name);
                    if (state) {
                        isPlaying = state.isPlaying;
                    }
                }
                const info = {
                    currentClip: currentClip ? currentClip.name : null,
                    clips: anim.getClips().map((c) => c.name),
                    playOnLoad: anim.playOnLoad,
                    isPlaying: isPlaying,
                };
                if (event.reply) event.reply(null, info);
                break;

            case "play":
                if (!clipName) {
                    anim.play();
                    if (event.reply) event.reply(null, "正在播放默认动画剪辑");
                } else {
                    anim.play(clipName);
                    if (event.reply) event.reply(null, `正在播放动画剪辑: ${clipName}`);
                }
                break;

            case "stop":
                anim.stop();
                if (event.reply) event.reply(null, "动画已停止");
                break;

            case "pause":
                anim.pause();
                if (event.reply) event.reply(null, "动画已暂停");
                break;

            case "resume":
                anim.resume();
                if (event.reply) event.reply(null, "动画已恢复播放");
                break;

            default:
                if (event.reply) event.reply(new Error(`未知的动画操作类型: ${action}`));
                break;
        }
    },
};

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
		let node = cc.engine.getInstanceById(id);

		if (node) {
			if (x !== undefined) node.x = x;
			if (y !== undefined) node.y = y;
			if (scaleX !== undefined) node.scaleX = scaleX;
			if (scaleY !== undefined) node.scaleY = scaleY;
			if (color) {
				// color 格式如 "#FF0000"
				node.color = new cc.Color().fromHEX(color);
			}

			Editor.Ipc.sendToMain("scene:dirty");
			Editor.Ipc.sendToAll("scene:node-changed", { uuid: id });

			if (event.reply) event.reply(null, "Transform updated");
		} else {
			if (event.reply) event.reply(new Error("Node not found"));
		}
	},
	"create-node": function (event, args) {
		const { name, parentId, type } = args;
		const scene = cc.director.getScene();
		if (!scene || !cc.director.getRunningScene()) {
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
						for (const [key, value] of Object.entries(properties)) {
							if (component[key] !== undefined) {
								component[key] = value;
							}
						}
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
					const component = node.getComponentById(componentId);
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

			case "get":
				try {
					const components = node._components.map((c) => {
						// 获取组件属性
						const properties = {};
						for (const key in c) {
							if (typeof c[key] !== "function" && 
								!key.startsWith("_") && 
								c[key] !== undefined) {
								try {
									properties[key] = c[key];
								} catch (e) {
									// 忽略无法序列化的属性
								}
							}
						}
						return {
							type: c.__typename,
							uuid: c.uuid,
							properties: properties
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
			if (typeof component[key] !== "function" && 
				!key.startsWith("_") && 
				component[key] !== undefined) {
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
		const { prefabPath, parentId } = args;
		const scene = cc.director.getScene();

		if (!scene || !cc.director.getRunningScene()) {
			if (event.reply) event.reply(new Error("Scene not ready or loading."));
			return;
		}

		// 加载预制体资源
		cc.loader.loadRes(prefabPath.replace("db://assets/", "").replace(".prefab", ""), cc.Prefab, (err, prefab) => {
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
};

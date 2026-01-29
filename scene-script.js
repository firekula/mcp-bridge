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
};

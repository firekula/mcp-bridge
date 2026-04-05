import * as fs from "fs";
import * as os from "os";
import * as pathMod from "path";
import * as crypto from "crypto";
import { Logger } from "../core/Logger";

export class AssetPatcher {
	/**
	 * 生成 22 位 Base64 URL-safe 随机字符串，用作预制体 fileId
	 */
	public static generateFileId(): string {
		return crypto.randomBytes(16).toString("base64").replace(/\+/g, "/").replace(/=/g, "").substring(0, 22);
	}

	/**
	 * 修复预制体文件中根节点的空 fileId 问题
	 */
	public static fixPrefabRootFileId(prefabFspath: string): boolean {
		try {
			if (!fs.existsSync(prefabFspath)) {
				Logger.warn(`[fixPrefabRootFileId] 预制体文件不存在: ${prefabFspath}`);
				return false;
			}
			const content = fs.readFileSync(prefabFspath, "utf8");
			const data = JSON.parse(content);

			if (!Array.isArray(data) || data.length === 0) {
				Logger.warn(`[fixPrefabRootFileId] 预制体内容格式异常`);
				return false;
			}

			const prefabEntry = data[0];
			if (!prefabEntry || prefabEntry.__type__ !== "cc.Prefab" || !prefabEntry.data) {
				Logger.warn(`[fixPrefabRootFileId] 找不到 cc.Prefab 入口`);
				return false;
			}
			const rootNodeIndex = prefabEntry.data.__id__;
			const rootNode = data[rootNodeIndex];
			if (!rootNode || !rootNode._prefab) {
				Logger.warn(`[fixPrefabRootFileId] 根节点没有 _prefab 引用`);
				return false;
			}

			const prefabInfoIndex = rootNode._prefab.__id__;
			const prefabInfo = data[prefabInfoIndex];
			if (!prefabInfo || prefabInfo.__type__ !== "cc.PrefabInfo") {
				Logger.warn(`[fixPrefabRootFileId] 根节点 _prefab 指向的不是 cc.PrefabInfo`);
				return false;
			}

			if (!prefabInfo.fileId || prefabInfo.fileId === "") {
				prefabInfo.fileId = AssetPatcher.generateFileId();
				fs.writeFileSync(prefabFspath, JSON.stringify(data, null, 2), "utf8");
				Logger.success(`[fixPrefabRootFileId] 已修复根节点 fileId: ${prefabInfo.fileId}`);
				return true;
			}

			return false;
		} catch (e) {
			Logger.error(`[fixPrefabRootFileId] 修复失败: ${e.message}`);
			return false;
		}
	}

	/**
	 * 安全创建资源 (V8 完美原子级联方案)
	 */
	public static safeCreateAsset(path: string, content: string | Buffer, originalCallback: Function, postCreateModifier: Function | null = null) {
		const fileName = path.substring(path.lastIndexOf("/") + 1);

		let currentUrl = path.substring(0, path.lastIndexOf("/"));
		let missingDirs: string[] = [];

		while (currentUrl !== "db://assets" && currentUrl !== "db://internal" && currentUrl !== "db://") {
			if (Editor.assetdb.exists(currentUrl)) {
				break;
			}
			missingDirs.unshift(currentUrl.substring(currentUrl.lastIndexOf("/") + 1));
			currentUrl = currentUrl.substring(0, currentUrl.lastIndexOf("/"));
		}

		if (!Editor.assetdb.exists(currentUrl)) {
			return originalCallback(`致命错误：最终回退的根目录都不存在： ${currentUrl}`);
		}

		const tempBase = pathMod.join(os.tmpdir(), "mcp_v8_" + Date.now() + "_" + Math.floor(Math.random() * 1000));
		let deepTempPath = tempBase;

		for (let i = 0; i < missingDirs.length; i++) {
			deepTempPath = pathMod.join(deepTempPath, missingDirs[i]);
		}

		try {
			fs.mkdirSync(deepTempPath, { recursive: true });
			const fileTempPath = pathMod.join(deepTempPath, fileName);
			fs.writeFileSync(fileTempPath, content);
		} catch (e) {
			return originalCallback(`在临时隔离区写入文件失败: ${e.message}`);
		}

		const topImportTarget = missingDirs.length > 0 ? pathMod.join(tempBase, missingDirs[0]) : pathMod.join(tempBase, fileName);

		const doneCreate = (err?: any, msg?: string) => {
			try {
				fs.rmdirSync(tempBase, { recursive: true });
			} catch (e) {}
			if (err) return originalCallback(err);
			originalCallback(null, msg);
		};

		Editor.assetdb.import([topImportTarget], currentUrl, (impErr: any, results: any) => {
			if (impErr) return doneCreate(`原生导入操作失败: ${impErr.message || impErr}`);

			if (postCreateModifier) {
				postCreateModifier(doneCreate);
			} else {
				doneCreate(null, `资源已安全原生导入: ${path}`);
			}
		});
	}
}

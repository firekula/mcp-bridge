import * as http from "http";
import { Logger } from "./Logger";

export class HttpServer {
	private static mcpServer: http.Server | null = null;
	public static config = {
		port: 3456,
		active: false,
	};

	/**
	 * 启动 HTTP 服务器
	 */
	public static start(port: number, requestHandler: (req: http.IncomingMessage, res: http.ServerResponse) => void) {
		if (HttpServer.mcpServer) HttpServer.stop();

		const tryStart = (currentPort: number, retries: number) => {
			if (retries <= 0) {
				Logger.error(`Failed to find an available port after multiple attempts.`);
				return;
			}

			try {
				HttpServer.mcpServer = http.createServer((req, res) => {
					HttpServer.handleRawRequest(req, res, requestHandler);
				});

				HttpServer.mcpServer.on("error", (e: any) => {
					if (e.code === "EADDRINUSE") {
						Logger.warn(`Port ${currentPort} is in use, trying ${currentPort + 1}...`);
						try {
							if (HttpServer.mcpServer) HttpServer.mcpServer.close();
						} catch (err) {}
						HttpServer.mcpServer = null;
						setTimeout(() => {
							tryStart(currentPort + 1, retries - 1);
						}, 100);
					} else {
						Logger.error(`Server Error: ${e.message}`);
					}
				});

				HttpServer.mcpServer.listen(currentPort, () => {
					HttpServer.config.active = true;
					HttpServer.config.port = currentPort;
					Logger.success(`MCP Server running at http://127.0.0.1:${currentPort}`);
					if (Editor && Editor.Ipc) {
						try {
							Editor.Ipc.sendToPanel("mcp-bridge", "mcp-bridge:state-changed", HttpServer.config);
						} catch (_e) { /* 面板未打开 */ }
					}
				});
			} catch (e) {
				Logger.error(`Failed to start server: ${e.message}`);
			}
		};

		tryStart(port, 10);
	}

	/**
	 * 拦截并校验请求体大小，然后传递给业务 Router
	 */
	private static handleRawRequest(req: http.IncomingMessage, res: http.ServerResponse, handler: Function) {
		res.setHeader("Content-Type", "application/json");
		res.setHeader("Access-Control-Allow-Origin", "*");

		const MAX_BODY_SIZE = 5 * 1024 * 1024;
		let body = "";
		let aborted = false;

		req.on("data", (chunk) => {
			body += chunk;
			if (body.length > MAX_BODY_SIZE) {
				aborted = true;
				Logger.error(`[HTTP] 请求体超过 ${MAX_BODY_SIZE} 字节上限，已拒绝`);
				res.writeHead(413);
				res.end(JSON.stringify({ error: "请求体过大" }));
				req.destroy();
			}
		});

		req.on("end", () => {
			if (aborted) return;
			// 附加 body 至 req，方便传递
			(req as any).bodyString = body;
			handler(req, res);
		});
	}

	/**
	 * 关闭 HTTP 服务器
	 */
	public static stop() {
		if (HttpServer.mcpServer) {
			HttpServer.mcpServer.close();
			HttpServer.mcpServer = null;
			HttpServer.config.active = false;
			Logger.warn("MCP Server stopped");
			if (Editor && Editor.Ipc) {
				try {
					Editor.Ipc.sendToPanel("mcp-bridge", "mcp-bridge:state-changed", HttpServer.config);
				} catch (_e) { /* 面板未打开 */ }
			}
		}
	}
}

import { Logger } from "./Logger";
import { CommandQueue } from "./CommandQueue";
import { getToolsList } from "../tools/ToolRegistry";
import { ToolDispatcher } from "../tools/ToolDispatcher";
import { McpWrappers } from "./McpWrappers";

export class McpRouter {
	public static handleRequest(req: any, res: any) {
		const url = req.url;
		const body = req.bodyString; // 附加在请求上的 body 字符串

		if (url === "/list-tools") {
			const tools = getToolsList();
			Logger.info(`AI Client requested tool list`);
			res.writeHead(200);
			return res.end(JSON.stringify({ tools: tools }));
		}

		if (url === "/list-resources") {
			const resources = McpWrappers.getResourcesList();
			Logger.info(`AI Client requested resource list`);
			res.writeHead(200);
			return res.end(JSON.stringify({ resources: resources }));
		}

		if (url === "/read-resource") {
			try {
				const { uri } = JSON.parse(body || "{}");
				Logger.mcp(`READ -> [${uri}]`);
				McpWrappers.handleReadResource(uri, (err: any, content: any) => {
					if (err) {
						Logger.error(`读取失败: ${err}`);
						res.writeHead(500);
						return res.end(JSON.stringify({ error: err }));
					}
					Logger.success(`读取成功: ${uri}`);
					res.writeHead(200);
					res.end(
						JSON.stringify({
							contents: [
								{
									uri: uri,
									mimeType: "application/json",
									text: typeof content === "string" ? content : JSON.stringify(content),
								},
							],
						}),
					);
				});
			} catch (e: any) {
				res.writeHead(500);
				res.end(JSON.stringify({ error: e.message }));
			}
			return;
		}

		if (url === "/call-tool") {
			try {
				const { name, arguments: args } = JSON.parse(body || "{}");
				let argsPreview = "";
				if (args) {
					try {
						argsPreview = typeof args === "object" ? JSON.stringify(args) : String(args);
					} catch (e) {
						argsPreview = "[无法序列化的参数]";
					}
				}
				Logger.mcp(`REQ -> [${name}] (队列长度: ${CommandQueue.getLength()}) 参数: ${argsPreview}`);

				CommandQueue.enqueue((done) => {
					ToolDispatcher.handleMcpCall(name, args, (err: any, result: any) => {
						const response = {
							content: [
								{
									type: "text",
									text: err
										? `Error: ${err}`
										: typeof result === "object"
											? JSON.stringify(result)
											: result,
								},
							],
						};
						if (err) {
							Logger.error(`RES <- [${name}] 失败: ${err}`);
						} else {
							let preview = "";
							if (typeof result === "string") {
								preview = result;
							} else if (typeof result === "object") {
								try {
									preview = JSON.stringify(result);
								} catch (e) {
									preview = "Object (Circular/Unserializable)";
								}
							}
							Logger.success(`RES <- [${name}] 成功 : ${preview}`);
						}
						res.writeHead(200);
						res.end(JSON.stringify(response));
						done();
					});
				}).catch((rejectReason: any) => {
					res.writeHead(429);
					res.end(JSON.stringify({ error: String(rejectReason) }));
				});
			} catch (e: any) {
				if (e instanceof SyntaxError) {
					Logger.error(`JSON Parse Error: ${e.message}`);
					res.writeHead(400);
					res.end(JSON.stringify({ error: "Invalid JSON" }));
				} else {
					Logger.error(`Internal Server Error: ${e.message}`);
					res.writeHead(500);
					res.end(JSON.stringify({ error: e.message }));
				}
			}
			return;
		}

		res.writeHead(404);
		res.end(JSON.stringify({ error: "Not Found", url: url }));
	}
}

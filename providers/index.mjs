// Registry — aggregates all web-provider adapters into PROVIDERS/BY_ID.
import { kimiWeb } from "./kimi.mjs";
import { zaiWeb } from "./zai.mjs";
import { chatglmWeb } from "./chatglm.mjs";
import { deepseekWeb } from "./deepseek.mjs";
import { doubaoWeb } from "./doubao.mjs";
import { qwenWeb } from "./qwen.mjs";

export const PROVIDERS = [kimiWeb, zaiWeb, chatglmWeb, deepseekWeb, doubaoWeb, qwenWeb];
export const BY_ID = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));

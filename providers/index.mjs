// Registry — aggregates all web-provider adapters into PROVIDERS/BY_ID.
// Free (no subscription) web-cookie providers from OmniRoute.
import { kimiWeb } from "./kimi.mjs";
import { zaiWeb } from "./zai.mjs";
import { chatglmWeb } from "./chatglm.mjs";
import { deepseekWeb } from "./deepseek.mjs";
import { doubaoWeb } from "./doubao.mjs";
import { qwenWeb } from "./qwen.mjs";
// Free web-cookie providers
import { lmarena } from "./lmarena.mjs";
import { huggingchat } from "./huggingchat.mjs";
import { geminiBusiness } from "./gemini-business.mjs";
import { tinycmsWeb } from "./tinycms.mjs";
import { zenmuxFree } from "./zenmux-free.mjs";
import { museSparkWeb } from "./muse-spark.mjs";
import { t3Web } from "./t3-web.mjs";
import { yuanbaoWeb } from "./yuanbao.mjs";

export const PROVIDERS = [
  kimiWeb,
  zaiWeb,
  chatglmWeb,
  deepseekWeb,
  doubaoWeb,
  qwenWeb,
  // Free providers
  lmarena,
  huggingchat,
  geminiBusiness,
  tinycmsWeb,
  zenmuxFree,
  museSparkWeb,
  t3Web,
  yuanbaoWeb,
];
export const BY_ID = Object.fromEntries(PROVIDERS.map((p) => [p.id, p]));
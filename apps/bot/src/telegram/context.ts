import type { Context } from "telegraf";
import type { Config } from "../config.js";

/** Bot-wide context: config is attached once in createBot(). */
export interface BotContext extends Context {
  config: Config;
}

/** Context inside bot.action(/^regex$/) — carries the regex match. */
export type ActionCtx = BotContext & { match: RegExpExecArray };

export type Handler = (ctx: BotContext) => Promise<void> | void;

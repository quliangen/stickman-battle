import { GoogleGenAI } from "@google/genai";
import { GameStats } from "../types";

const createClient = () => {
  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    console.warn("未找到 API Key，AI 功能将不可用。");
    return null;
  }
  return new GoogleGenAI({ apiKey });
};

export const getTacticalAnalysis = async (stats: GameStats): Promise<string> => {
  const client = createClient();
  if (!client) return "解说席信号中断... (未配置 API Key)";

  try {
    const prompt = `
      你是一位热血的**格斗游戏解说员** 🎙️。
      刚结束了一场精彩的 ${stats.mode === 'PVP' ? '双人死斗' : '人机对决'}。
      
      --- 比赛数据 ---
      获胜方：${stats.winner || '平局'}
      比赛耗时：${Math.floor(stats.duration)} 秒
      ----------------

      请用激情澎湃的中文风格点评这场比赛：
      1. 如果时间很短（<20秒），嘲讽输家太弱或赞美赢家秒杀。
      2. 如果时间很长（>60秒），感叹这是一场拉锯战。
      3. 必须包含一句对输家的“扎心”建议。
      4. 字数控制在 60 字以内。
    `;

    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text || "比赛结束！这真是一场令人窒息的对决！";
  } catch (error: any) {
    // 专门处理配额耗尽错误 (429 / RESOURCE_EXHAUSTED)
    // 检查多层级可能的错误码
    const isQuotaError = (err: any) => {
        if (!err) return false;
        if (err.status === 'RESOURCE_EXHAUSTED' || err.status === 429) return true;
        if (err.code === 429 || err.code === 'RESOURCE_EXHAUSTED') return true;
        // 某些情况下错误被包裹在 error 属性中
        if (err.error?.code === 429 || err.error?.status === 'RESOURCE_EXHAUSTED') return true;
        if (err.message && (err.message.includes('429') || err.message.includes('quota') || err.message.includes('RESOURCE_EXHAUSTED'))) return true;
        return false;
    }

    if (isQuotaError(error)) {
      console.warn("Gemini API Quota Exceeded (429). Using fallback message.");
      return "（解说员喝水去了 ☕）当前观众热情过高（API配额耗尽），AI 暂时无法点评。但你的英勇战斗已被铭记！";
    }
    
    console.error("Gemini API Error:", error);
    return "精彩的比赛！让我们期待下一场！";
  }
};
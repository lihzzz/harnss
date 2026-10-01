export type TimeBucket = "lateNight" | "morning" | "afternoon" | "evening";

export interface ContinueMessage {
  headline: string;
  subtitle: string;
  accent: string;
}

const ZH_CONTINUE_MESSAGES: Record<string, ContinueMessage> = {
  "Continue building": { headline: "继续构建", subtitle: "你的对话还在等你。选一个继续发布成果。", accent: "" },
  "Welcome back": { headline: "欢迎回来", subtitle: "代码仓库想你了——其实才过去几秒。", accent: "" },
  "Back at it, menace": { headline: "继续折腾吧", subtitle: "选一个对话，开始一场优雅的混乱。", accent: "" },
  "One more tiny change": { headline: "再改一个小地方", subtitle: "经典的最后一句话。你的对话正在等你。", accent: "" },
  "Hello, night owl": { headline: "你好，夜猫子", subtitle: "最好的想法和最糟的提交信息都在此刻出现。", accent: "" },
  "Midnight debug club": { headline: "午夜调试俱乐部", subtitle: "堆栈信息正在黑暗中温柔地发光。", accent: "" },
  "Moonlight merge pending": { headline: "月光下等待合并", subtitle: "在鸟儿上班前，接着完成刚才的工作。", accent: "" },
  "Good morning, builder": { headline: "早上好，构建者", subtitle: "新标签页，新咖啡，同一张超长 TODO 清单。", accent: "" },
  "Rise and refactor": { headline: "起床重构", subtitle: "你的对话比一些同事醒得还早。", accent: "" },
  "Morning commit energy": { headline: "清晨提交能量", subtitle: "趁会议找到你之前，先完成一个简单目标。", accent: "" },
  "Welcome back, sunshine": { headline: "欢迎回来，阳光", subtitle: "把半成品想法变成真正功能的黄金时段。", accent: "" },
  "Afternoon sprint mode": { headline: "午后冲刺模式", subtitle: "代码正热，对话也已经排好队了。", accent: "" },
  "Post-lunch patch attack": { headline: "午后补丁出击", subtitle: "选一个对话，让路线图变得更可信。", accent: "" },
  "Evening shift engaged": { headline: "晚班已开始", subtitle: "安静的时间，专注的状态，带一点小恶魔能量。", accent: "" },
  "Twilight build session": { headline: "暮色构建时刻", subtitle: "适合发布一些聪明又没必要的东西。", accent: "" },
  "Welcome back after hours": { headline: "欢迎下班后回来", subtitle: "你的对话已准备好接受那次“很快看一下”。", accent: "" },
};

const ANYTIME_CONTINUE_MESSAGES: readonly ContinueMessage[] = [
  {
    headline: "Continue building",
    subtitle: "Your threads are warm. Pick one and keep shipping.",
    accent: "oklch(0.62 0.18 185)",
  },
  {
    headline: "Welcome back",
    subtitle: "The repo missed you for several whole seconds.",
    accent: "oklch(0.66 0.16 32)",
  },
  {
    headline: "Back at it, menace",
    subtitle: "Choose a thread and apply tasteful chaos.",
    accent: "oklch(0.7 0.17 145)",
  },
  {
    headline: "One more tiny change",
    subtitle: "Famous last words. Your threads are waiting.",
    accent: "oklch(0.72 0.14 260)",
  },
];

const TIME_AWARE_CONTINUE_MESSAGES: Record<TimeBucket, readonly ContinueMessage[]> = {
  lateNight: [
    {
      headline: "Hello, night owl",
      subtitle: "Your best ideas and worst commit messages happen now.",
      accent: "oklch(0.7 0.15 250)",
    },
    {
      headline: "Midnight debug club",
      subtitle: "The stack trace is glowing gently in the dark.",
      accent: "oklch(0.68 0.18 290)",
    },
    {
      headline: "Moonlight merge pending",
      subtitle: "Pick up where you left off before the birds clock in.",
      accent: "oklch(0.74 0.13 215)",
    },
  ],
  morning: [
    {
      headline: "Good morning, builder",
      subtitle: "Fresh tab, fresh coffee, same huge TODO list.",
      accent: "oklch(0.76 0.16 78)",
    },
    {
      headline: "Rise and refactor",
      subtitle: "Your threads are awake before some of your teammates.",
      accent: "oklch(0.73 0.17 110)",
    },
    {
      headline: "Morning commit energy",
      subtitle: "Start with the easy win before the meetings find you.",
      accent: "oklch(0.78 0.15 48)",
    },
  ],
  afternoon: [
    {
      headline: "Welcome back, sunshine",
      subtitle: "Prime hour for turning half-finished ideas into features.",
      accent: "oklch(0.74 0.18 58)",
    },
    {
      headline: "Afternoon sprint mode",
      subtitle: "The code is warm and your threads are lined up.",
      accent: "oklch(0.68 0.19 28)",
    },
    {
      headline: "Post-lunch patch attack",
      subtitle: "Pick a thread and make the roadmap more believable.",
      accent: "oklch(0.75 0.16 135)",
    },
  ],
  evening: [
    {
      headline: "Evening shift engaged",
      subtitle: "Quiet hours. Strong focus. Mild gremlin energy.",
      accent: "oklch(0.67 0.17 15)",
    },
    {
      headline: "Twilight build session",
      subtitle: "A nice time to ship something clever and unnecessary.",
      accent: "oklch(0.69 0.18 335)",
    },
    {
      headline: "Welcome back after hours",
      subtitle: "Your threads are ready for that definitely quick check-in.",
      accent: "oklch(0.72 0.15 210)",
    },
  ],
};

function getTimeBucket(date: Date): TimeBucket {
  const hour = date.getHours();
  if (hour < 5) {
    return "lateNight";
  }
  if (hour < 12) {
    return "morning";
  }
  if (hour < 18) {
    return "afternoon";
  }
  return "evening";
}

function pickRandomMessage(
  messages: readonly ContinueMessage[],
  previous?: ContinueMessage,
): ContinueMessage {
  if (messages.length === 1) {
    return messages[0];
  }

  let nextMessage = messages[Math.floor(Math.random() * messages.length)];
  if (!previous) {
    return nextMessage;
  }

  let attempts = 0;
  while (
    attempts < 6 &&
    nextMessage.headline === previous.headline &&
    nextMessage.subtitle === previous.subtitle
  ) {
    nextMessage = messages[Math.floor(Math.random() * messages.length)];
    attempts += 1;
  }

  return nextMessage;
}

function getContinueMessageHourKey(date: Date): string {
  return [
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    date.getHours(),
  ].join(":");
}

export function getContinueMessage(
  previous?: ContinueMessage,
  now: Date = new Date(),
): ContinueMessage {
  const bucket = getTimeBucket(now);
  return pickRandomMessage(
    [...TIME_AWARE_CONTINUE_MESSAGES[bucket], ...ANYTIME_CONTINUE_MESSAGES],
    previous,
  );
}

/** Return the same welcome message in the selected UI language. */
export function localizeContinueMessage(message: ContinueMessage, language: "zh-CN" | "en-US"): ContinueMessage {
  if (language !== "zh-CN") return message;
  const localized = ZH_CONTINUE_MESSAGES[message.headline];
  return localized ? { ...localized, accent: message.accent } : message;
}

export function getNextContinueMessageDelay(now: Date = new Date()): number {
  const nextHour = new Date(now);
  nextHour.setHours(now.getHours() + 1, 0, 0, 0);
  return Math.max(nextHour.getTime() - now.getTime(), 60_000);
}

export function shouldRefreshContinueMessage(
  lastRefreshedAt: Date,
  now: Date = new Date(),
): boolean {
  return getContinueMessageHourKey(lastRefreshedAt) !== getContinueMessageHourKey(now);
}

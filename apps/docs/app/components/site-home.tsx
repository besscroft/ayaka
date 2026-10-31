import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUpRight,
  BookOpen,
  Bookmark,
  Heart,
  KeyRound,
  Laptop,
  Menu,
  NotebookPen,
  ScrollText,
  Wrench,
  X,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { releaseSummary } from "@/lib/release-format";
import { fetchLatestRelease, type ReleasePageData } from "@/lib/release-client";

const NAV_LINKS = [
  ["她会记得", "#memory"],
  ["她在做事", "#trace"],
  ["本地边界", "#local"],
] as const;

const MEMORY_KINDS = [
  {
    icon: Bookmark,
    title: "事实",
    description: "你的项目、习惯和常用工具。",
  },
  {
    icon: Heart,
    title: "偏好",
    description: "说话的方式、作息、在意的细节。",
  },
  {
    icon: BookOpen,
    title: "经历",
    description: "一起聊过的话题和没讲完的故事。",
  },
  {
    icon: Wrench,
    title: "技能",
    description: "教过她的做法，下次直接会用。",
  },
] as const;

const MEMORY_CARDS = [
  {
    kind: "偏好",
    text: "周三想早点睡，23:00 提醒我放下工作。",
  },
  {
    kind: "事实",
    text: "这个项目用 pnpm，命令都走 vp run。",
  },
  {
    kind: "经历",
    text: "上周聊到一半的那本书，她想读完第三章。",
  },
] as const;

const TRACE_STEPS = [
  {
    label: "输入",
    title: "说出任务",
    description: "从一句话开始，她先确认你真正要完成什么。",
  },
  {
    label: "智能体循环",
    title: "拆解与行动",
    description: "运行被拆成连续步骤，每一步都有来源、状态和下一步。",
  },
  {
    label: "技能与工具",
    title: "按需接入",
    description: "需要工具时再接入，敏感操作保留清晰的审核边界。",
  },
  {
    label: "记忆",
    title: "留下线索",
    description: "有价值的事实与偏好进入本地记忆，下一次继续接上。",
  },
  {
    label: "结果",
    title: "回到结果",
    description: "每次运行都有可读摘要，也可以追溯过程与诊断信息。",
  },
] as const;

const LOCAL_RULES = [
  {
    icon: Laptop,
    title: "数据默认留在本机",
    description: "SQLite 与本地文件记录工作上下文，不需要先搭一套云端服务。",
    tag: "本地",
  },
  {
    icon: KeyRound,
    title: "密钥留在主进程",
    description: "Provider、MCP 与 Skill secrets 在受保护边界内解析，从不回传明文。",
    tag: "已封存",
  },
  {
    icon: ScrollText,
    title: "每次行动都有记录",
    description: "运行、工具调用、审批与诊断都写进可追溯的本地表。",
    tag: "可追踪",
  },
] as const;

function revealDelay(ms: number): CSSProperties {
  return { "--reveal-delay": `${ms}ms` } as CSSProperties;
}

function PrimaryButton({
  children,
  href,
  external = false,
  className,
}: {
  children: ReactNode;
  href: string;
  external?: boolean;
  className?: string;
}) {
  return (
    <a
      className={cn(
        "inline-flex min-h-10 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-semibold text-paper transition-colors duration-200 hoverable:hover:bg-ink-hover focus-visible:outline-2 focus-visible:outline-offset-2",
        className,
      )}
      href={href}
      rel={external ? "noreferrer" : undefined}
      target={external ? "_blank" : undefined}
    >
      {children}
    </a>
  );
}

function SecondaryButton({
  children,
  href,
  className,
}: {
  children: ReactNode;
  href: string;
  className?: string;
}) {
  return (
    <a
      className={cn(
        "inline-flex min-h-10 items-center gap-2 rounded-lg border border-line bg-card px-4 text-sm font-semibold text-ink transition-colors duration-200 hoverable:hover:bg-hover",
        className,
      )}
      href={href}
    >
      {children}
    </a>
  );
}

function Bubble({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "relative inline-block rounded-xl rounded-bl-sm border border-line bg-card px-4 py-3 text-sm leading-6 text-ink shadow-card",
        className,
      )}
    >
      {children}
      <span
        aria-hidden="true"
        className="absolute -bottom-[5px] left-5 size-2.5 rotate-45 border-b border-l border-line bg-card"
      />
    </div>
  );
}

function DownloadAction({
  releaseData,
  children,
}: {
  releaseData: ReleasePageData;
  children: ReactNode;
}) {
  if (releaseData.status !== "available") {
    return <PrimaryButton href="/download">获取 Ayaka</PrimaryButton>;
  }

  return (
    <PrimaryButton href={releaseData.release.downloadUrl} external>
      {children}
    </PrimaryButton>
  );
}

export function useReleaseData(initialReleaseData: ReleasePageData) {
  const [releaseData, setReleaseData] = useState(initialReleaseData);

  useEffect(() => {
    if (initialReleaseData.status === "available") return;

    const controller = new AbortController();
    void fetchLatestRelease(controller.signal)
      .then((nextReleaseData) => {
        if (nextReleaseData.status === "available") setReleaseData(nextReleaseData);
      })
      .catch(() => undefined);

    return () => controller.abort();
  }, [initialReleaseData]);

  return releaseData;
}

export function useReveal() {
  useEffect(() => {
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !("IntersectionObserver" in window)
    ) {
      return;
    }

    document.documentElement.classList.add("reveal-ready");
    const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-reveal]"));
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-revealed");
            observer.unobserve(entry.target);
          }
        }
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.08 },
    );

    targets.forEach((target) => observer.observe(target));
    return () => observer.disconnect();
  }, []);
}

export function SiteHeader({ homePath = "" }: { homePath?: string }) {
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const homeHref = homePath ? `${homePath}#top` : "#top";

  const closeMenu = () => setIsMenuOpen(false);

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-paper/80 backdrop-blur-[14px] backdrop-saturate-150">
      <div className="mx-auto flex h-14 max-w-[1200px] items-center justify-between px-4 md:px-8">
        <a className="flex items-center gap-2.5" href={homeHref} aria-label="Ayaka 首页">
          <img
            className="size-7 rounded-full object-cover object-top"
            src="/favicon.png"
            alt=""
            aria-hidden="true"
          />
          <span className="text-[15px] font-bold tracking-[0.04em] text-ink">AYAKA</span>
        </a>

        <nav className="hidden items-center gap-7 text-sm font-medium text-ink-soft md:flex">
          {NAV_LINKS.map(([label, href]) => (
            <a
              className="transition-colors duration-200 hover:text-ink"
              href={homePath ? `${homePath}${href}` : href}
              key={href}
            >
              {label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <a
            className="hidden min-h-9 items-center rounded-lg bg-ink px-3.5 text-sm font-semibold text-paper transition-colors duration-200 hoverable:hover:bg-ink-hover sm:inline-flex"
            href="/download"
          >
            下载
          </a>
          <button
            className="grid size-9 place-items-center rounded-lg text-ink transition-colors duration-200 hoverable:hover:bg-hover md:hidden"
            type="button"
            aria-expanded={isMenuOpen}
            aria-controls="mobile-nav"
            aria-label={isMenuOpen ? "关闭菜单" : "打开菜单"}
            onClick={() => setIsMenuOpen((open) => !open)}
          >
            {isMenuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>

        <nav
          id="mobile-nav"
          className={cn(
            "absolute inset-x-4 top-[calc(100%+8px)] origin-top rounded-xl border border-line bg-card p-2 shadow-float transition-[opacity,transform] duration-200 ease-out md:hidden",
            isMenuOpen
              ? "translate-y-0 scale-100 opacity-100"
              : "pointer-events-none -translate-y-1 scale-[0.98] opacity-0",
          )}
          aria-hidden={!isMenuOpen}
          inert={!isMenuOpen}
        >
          {[
            ...NAV_LINKS.map(([label, href]) => [label, homePath ? `${homePath}${href}` : href]),
            ["下载", "/download"],
          ].map(([label, href]) => (
            <a
              className="flex items-center justify-between rounded-lg px-3.5 py-2.5 text-sm font-medium text-ink transition-colors duration-200 hoverable:hover:bg-hover"
              href={href}
              key={href}
              onClick={closeMenu}
            >
              {label}
              <ArrowUpRight aria-hidden="true" className="size-4 text-ink-soft" />
            </a>
          ))}
        </nav>
      </div>
    </header>
  );
}

function StatusChip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3 py-1.5 text-xs font-medium text-ink shadow-card">
      {children}
    </span>
  );
}

function Hero({ releaseData }: { releaseData: ReleasePageData }) {
  const summary = releaseData.status === "available" ? releaseSummary(releaseData.release) : null;

  return (
    <section className="bg-paper" id="top">
      <div className="mx-auto grid max-w-[1200px] gap-14 px-5 pt-20 md:px-8 md:pt-28 lg:grid-cols-[0.92fr_1.08fr] lg:items-end lg:gap-12 lg:pt-32">
        <div className="hero-rise max-w-xl lg:pb-28">
          <h1 className="text-[clamp(2.5rem,4vw,3.5rem)] font-bold leading-[1.1] tracking-[-0.01em] text-ink">
            <span className="block">她住在你电脑里，</span>
            <span className="block text-ink-faint">哪儿也不去。</span>
          </h1>
          <p className="mt-6 max-w-[34em] text-base leading-8 text-ink-soft">
            Ayaka 是对「数字生命体」路线的产品化实验：私人、主动、能延续关系的陪伴型
            AI。她的记忆、你的对话、每一次行动，都留在这台电脑上。
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <DownloadAction releaseData={releaseData}>下载 Windows 版</DownloadAction>
            <SecondaryButton href="#trace">
              看看她如何工作
              <ArrowDown aria-hidden="true" className="size-4" />
            </SecondaryButton>
          </div>
          <p className="mt-5 text-sm text-ink-soft tnum">
            {summary
              ? `${summary.version} · ${summary.size} · ${summary.date}`
              : "Windows x64 · 发布状态以下载页为准"}
          </p>
        </div>

        <div className="relative z-10 -mb-20 sm:-mb-24 lg:-mb-32">
          <Bubble className="hero-pop z-30 ml-0 block max-w-[280px] sm:ml-48 sm:inline-block sm:max-w-none">
            欢迎回来。你上次说要把报告收尾，我一直记着。
          </Bubble>

          <div
            className="hero-pop absolute left-0 top-20 z-20 w-32 sm:top-12 sm:w-40 lg:w-48"
            style={{ animationDelay: "160ms" }}
          >
            <div className="breathe overflow-hidden rounded-xl border border-line bg-card shadow-float">
              <img
                className="block h-auto w-full"
                src="/favicon.png"
                alt="Ayaka 的形象：黑白漫画风格的马尾少女，带着浅浅的笑"
                width={1240}
                height={1240}
                decoding="async"
              />
            </div>
          </div>

          <div
            className="hero-rise relative mt-20 overflow-hidden rounded-xl border border-line bg-card shadow-float sm:mt-24"
            style={{ animationDelay: "80ms" }}
          >
            <img
              className="block h-auto w-full"
              src="/example.png"
              alt="Ayaka 真实运行画面：一次任务中的工具调用与分析结果"
              width={2880}
              height={1716}
              fetchPriority="high"
              decoding="async"
            />
          </div>

          <div
            className="hero-pop absolute right-4 top-[calc(50%-3rem)] z-20 sm:right-6"
            style={{ animationDelay: "360ms" }}
          >
            <StatusChip>
              <span className="presence-dot size-2 rounded-full bg-live" />
              运行中 · 智能体在线
            </StatusChip>
          </div>
          <div
            className="hero-pop absolute -bottom-5 left-4 z-20 hidden sm:block"
            style={{ animationDelay: "440ms" }}
          >
            <StatusChip>
              <NotebookPen aria-hidden="true" className="size-3.5 text-ink-soft" />
              记忆已写入 · 本地
            </StatusChip>
          </div>
          <div
            className="hero-pop absolute -bottom-5 right-4 z-20 hidden lg:block"
            style={{ animationDelay: "520ms" }}
          >
            <StatusChip>
              <Laptop aria-hidden="true" className="size-3.5 text-ink-soft" />
              全部留在本机
            </StatusChip>
          </div>
        </div>
      </div>
    </section>
  );
}

function MemorySection() {
  return (
    <section className="bg-paper pt-36 pb-24 text-ink scroll-mt-16 md:pt-52 md:pb-32" id="memory">
      <div className="mx-auto grid max-w-[1200px] gap-14 px-5 md:px-8 lg:grid-cols-[1fr_0.9fr] lg:gap-16">
        <div data-reveal>
          <h2 className="max-w-md text-[clamp(1.75rem,3vw,2.5rem)] font-bold leading-[1.16] tracking-[-0.01em] text-balance">
            她会记得。
          </h2>
          <p className="mt-5 max-w-[30em] text-base leading-8 text-ink-soft">
            说过的话、定下的约定、项目的习惯——她把它们整理成本地记忆，下次见面时还在。记忆存在这台电脑上，只属于你们两个。
          </p>
          <ul className="mt-10 flex flex-col gap-5">
            {MEMORY_KINDS.map((kind) => (
              <li className="flex items-start gap-4" key={kind.title}>
                <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-line bg-card text-ink-soft shadow-card">
                  <kind.icon aria-hidden="true" className="size-5" />
                </span>
                <div>
                  <h3 className="font-semibold">{kind.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-ink-soft">{kind.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div
          className="flex flex-col justify-center lg:pl-6"
          data-reveal={true}
          style={revealDelay(120)}
        >
          <p className="mb-3 text-right text-xs text-ink-soft">以下为记忆示例</p>
          <div className="rounded-2xl border border-line bg-card px-6 py-2 shadow-card sm:px-7">
            {MEMORY_CARDS.map((card, index) => (
              <div
                className={cn(
                  "py-5",
                  index < MEMORY_CARDS.length - 1 && "border-b border-line-soft",
                )}
                key={card.kind}
              >
                <p className="text-xs font-medium text-ink-soft">{card.kind}</p>
                <p className="mt-1.5 text-[15px] leading-7">{card.text}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function TraceSection() {
  return (
    <section className="bg-paper py-24 text-ink scroll-mt-16 md:py-32" id="trace">
      <div className="mx-auto max-w-[1200px] px-5 md:px-8">
        <div data-reveal>
          <h2 className="max-w-lg text-[clamp(1.75rem,3vw,2.5rem)] font-bold leading-[1.16] tracking-[-0.01em] text-balance">
            她真的在做事。
          </h2>
          <p className="mt-5 max-w-[34em] text-base leading-8 text-ink-soft">
            每次运行都被拆成清晰的步骤：她想什么、用什么工具、结果从哪来，都写在同一条轨迹里。过程不藏在幕后。
          </p>
        </div>

        <figure
          className="mt-12 overflow-hidden rounded-xl border border-line bg-card shadow-float"
          data-reveal
        >
          <img
            className="block h-auto w-full"
            src="/example.png"
            alt="Ayaka 真实运行画面：对话中的工具调用、来源与状态"
            width={2880}
            height={1716}
            loading="lazy"
            decoding="async"
          />
          <figcaption className="border-t border-line px-5 py-3 text-xs text-ink-soft md:px-6">
            Ayaka 真实运行画面 · 每次搜索、每次工具调用，都有来源和状态
          </figcaption>
        </figure>

        <ol className="mt-14 flex flex-col">
          {TRACE_STEPS.map((step, index) => (
            <li
              className="relative flex gap-5 pb-10 last:pb-0 sm:gap-7"
              data-reveal={true}
              key={step.label}
              style={revealDelay(index * 60)}
            >
              <div className="flex flex-col items-center">
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-full text-sm font-semibold tnum",
                    index === 0 ? "bg-ink text-paper" : "border border-line bg-card text-ink-soft",
                  )}
                >
                  {index + 1}
                </span>
                {index < TRACE_STEPS.length - 1 && (
                  <span aria-hidden="true" className="mt-2 w-px flex-1 bg-line" />
                )}
              </div>
              <div className="pt-1.5">
                <p className="text-[13px] font-medium text-ink-soft">{step.label}</p>
                <h3 className="mt-1.5 text-lg font-semibold">{step.title}</h3>
                <p className="mt-1.5 max-w-xl text-sm leading-7 text-ink-soft">
                  {step.description}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function LocalSection() {
  return (
    <section className="bg-paper py-24 text-ink scroll-mt-16 md:py-32" id="local">
      <div className="mx-auto max-w-[1200px] px-5 md:px-8">
        <div data-reveal>
          <h2 className="max-w-lg text-[clamp(1.75rem,3vw,2.5rem)] font-bold leading-[1.16] tracking-[-0.01em] text-balance">
            她只留在你的电脑里。
          </h2>
          <p className="mt-5 max-w-[34em] text-base leading-8 text-ink-soft">
            本地优先是写进产品的前提。下面每一条，现在就成立。
          </p>
        </div>

        <div
          className="mt-12 rounded-2xl border border-line bg-card px-7 py-3 shadow-card sm:px-9"
          data-reveal
        >
          <ol className="flex flex-col">
            {LOCAL_RULES.map((rule, index) => (
              <li
                className={cn(
                  "flex flex-col gap-4 py-6 sm:flex-row sm:items-start sm:gap-6",
                  index < LOCAL_RULES.length - 1 && "border-b border-line-soft",
                )}
                key={rule.title}
              >
                <span className="grid size-10 shrink-0 place-items-center rounded-lg border border-line bg-paper text-ink-soft">
                  <rule.icon aria-hidden="true" className="size-5" />
                </span>
                <div className="sm:flex-1">
                  <h3 className="text-lg font-semibold">{rule.title}</h3>
                  <p className="mt-1.5 max-w-xl text-sm leading-7 text-ink-soft">
                    {rule.description}
                  </p>
                </div>
                <span className="inline-flex h-fit w-fit items-center rounded-full border border-line bg-paper px-2.5 py-0.5 text-xs font-medium text-ink-soft">
                  {rule.tag}
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}

function DownloadBanner({ releaseData }: { releaseData: ReleasePageData }) {
  const summary = releaseData.status === "available" ? releaseSummary(releaseData.release) : null;

  return (
    <section className="bg-paper py-24 text-ink scroll-mt-16 md:py-32" id="download">
      <div className="mx-auto max-w-[1200px] px-5 md:px-8">
        <div data-reveal>
          <h2 className="max-w-2xl text-[clamp(1.75rem,3.4vw,2.9rem)] font-bold leading-[1.16] tracking-[-0.01em] text-balance">
            现在，把她的窗开在你桌上。
          </h2>
          <p className="mt-5 max-w-[30em] text-base leading-8 text-ink-soft">
            一个安装包，几句自我介绍，她就开始记住你了。
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <DownloadAction releaseData={releaseData}>下载最新版本</DownloadAction>
            <SecondaryButton href="/download">查看平台信息</SecondaryButton>
          </div>
          <p className="mt-5 text-sm text-ink-soft tnum">
            {summary
              ? `${summary.version} · ${summary.size} · ${summary.date}`
              : "Windows x64 · 发布状态以下载页为准"}
          </p>
        </div>
      </div>
    </section>
  );
}

export function SiteFooter({ homePath = "" }: { homePath?: string }) {
  return (
    <footer className="border-t border-line bg-paper py-10 text-ink">
      <div className="mx-auto grid max-w-[1200px] gap-8 px-5 md:px-8 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <div className="flex items-center gap-2.5">
            <img
              className="size-8 rounded-full object-cover object-top"
              src="/favicon.png"
              alt=""
              aria-hidden="true"
            />
            <span className="text-[15px] font-bold tracking-[0.04em]">AYAKA</span>
          </div>
          <p className="mt-3 max-w-sm text-sm leading-7 text-ink-soft">
            对「数字生命体」路线的产品化实验
          </p>
        </div>
        <div className="flex flex-col gap-3 text-sm lg:items-end">
          <nav className="flex gap-6 text-ink-soft">
            <a className="transition-colors duration-200 hover:text-ink" href="/download">
              下载
            </a>
            <a
              className="transition-colors duration-200 hover:text-ink"
              href={homePath ? `${homePath}#top` : "#top"}
            >
              返回顶部
            </a>
          </nav>
          <p className="text-xs text-ink-soft">MIT 许可证 · © 2026 ZZZVoid · 默认本地运行</p>
        </div>
      </div>
    </footer>
  );
}

export function SiteHome({ releaseData }: { releaseData: ReleasePageData }) {
  const resolvedReleaseData = useReleaseData(releaseData);
  useReveal();

  return (
    <main className="bg-paper text-ink">
      <SiteHeader />
      <Hero releaseData={resolvedReleaseData} />
      <MemorySection />
      <TraceSection />
      <LocalSection />
      <DownloadBanner releaseData={resolvedReleaseData} />
      <SiteFooter />
    </main>
  );
}

export { Bubble, DownloadAction };

import { useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUpRight, CircleDot, Menu, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { releaseSummary } from "@/lib/release-format";
import { fetchLatestRelease, type ReleasePageData } from "@/lib/release-client";

const CAPABILITIES = [
  {
    index: "01",
    label: "对话",
    title: "对话是入口",
    description: "从一句自然语言开始，把问题交给一个真正能继续行动的工作台。",
  },
  {
    index: "02",
    label: "智能体",
    title: "智能体会协作",
    description: "身份、模型策略、工具选择与交接，都留在同一条可读的运行链路里。",
  },
  {
    index: "03",
    label: "记忆",
    title: "记忆留在上下文",
    description: "事实、偏好、经历和技能被整理成可追踪的本地记忆。",
  },
  {
    index: "04",
    label: "工具",
    title: "工具接入行动",
    description: "技能、MCP 和本地工具按需启用，也随时可以审阅和接管。",
  },
] as const;

const TRACE_STEPS = [
  {
    index: "01",
    label: "输入",
    title: "说出任务",
    description: "从一句话开始，Ayaka 先确认你真正要完成什么。",
    tone: "signal",
  },
  {
    index: "02",
    label: "智能体循环",
    title: "智能体行动",
    description: "运行被拆成连续步骤，每一步都有来源、状态和下一步。",
    tone: "mint",
  },
  {
    index: "03",
    label: "技能 + 工具",
    title: "调用能力",
    description: "需要工具时再接入，敏感操作保留清晰的审核边界。",
    tone: "coral",
  },
  {
    index: "04",
    label: "记忆",
    title: "留下线索",
    description: "有价值的事实与偏好进入本地记忆，下一次继续接上。",
    tone: "signal",
  },
  {
    index: "05",
    label: "结果",
    title: "回到结果",
    description: "每次运行都有可读摘要，也可以追溯过程与诊断信息。",
    tone: "mint",
  },
] as const;

const BOUNDARIES = [
  {
    index: "01",
    title: "数据默认留在本机",
    description: "SQLite 和本地文件记录工作上下文，不要求先搭一套云端服务。",
    status: "本地",
  },
  {
    index: "02",
    title: "密钥留在主进程",
    description: "Provider、MCP 和 Skill secrets 在受保护的运行边界内解析。",
    status: "已封存",
  },
  {
    index: "03",
    title: "每次行动都有记录",
    description: "运行状态、工具调用、审批与诊断都保留在可追踪的本地表里。",
    status: "可追踪",
  },
] as const;

function BracketLink({
  children,
  href,
  tone = "light",
  external = false,
}: {
  children: ReactNode;
  href: string;
  tone?: "light" | "dark";
  external?: boolean;
}) {
  return (
    <a
      className={cn(
        "group relative inline-flex min-h-12 items-center gap-3 px-5 text-sm font-semibold tracking-tight transition-transform duration-300 hover:translate-x-1 focus-visible:outline-2 focus-visible:outline-offset-4",
        tone === "light"
          ? "text-paper focus-visible:outline-paper"
          : "text-carbon focus-visible:outline-carbon",
      )}
      href={href}
      rel={external ? "noreferrer" : undefined}
      target={external ? "_blank" : undefined}
    >
      <span className="absolute left-0 top-0 size-3 border-l border-t border-current transition-transform duration-300 group-hover:-translate-x-1 group-hover:-translate-y-1" />
      <span className="absolute right-0 top-0 size-3 border-r border-t border-current transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-1" />
      <span className="absolute bottom-0 left-0 size-3 border-b border-l border-current transition-transform duration-300 group-hover:-translate-x-1 group-hover:translate-y-1" />
      <span className="absolute bottom-0 right-0 size-3 border-b border-r border-current transition-transform duration-300 group-hover:translate-x-1 group-hover:translate-y-1" />
      <span>{children}</span>
      <ArrowUpRight
        aria-hidden="true"
        className="transition-transform duration-300 group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
        data-icon="inline-end"
      />
    </a>
  );
}

function SectionKicker({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return (
    <p
      className={cn(
        "font-mono text-[0.68rem] font-medium uppercase tracking-[0.16em]",
        light ? "text-paper/55" : "text-graphite",
      )}
    >
      {children}
    </p>
  );
}

export function SiteHeader({ homePath = "" }: { homePath?: string }) {
  const [isScrolled, setIsScrolled] = useState(false);
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const handleScroll = () => setIsScrolled(window.scrollY > 20);
    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const closeMenu = () => setIsMenuOpen(false);

  const homeHref = homePath ? `${homePath}#top` : "#top";
  const sectionHref = (section: string) => `${homePath}#${section}`;

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 px-4 transition-all duration-500 md:px-8",
        isScrolled && "top-3",
      )}
    >
      <div
        className={cn(
          "mx-auto flex h-20 max-w-[1440px] items-center justify-between border-b border-paper/15 px-0 transition-all duration-500",
          isScrolled && "h-14 rounded-sm border border-paper/15 bg-carbon px-4 md:px-5",
        )}
      >
        <a
          className="group flex items-center gap-3 text-paper"
          href={homeHref}
          onClick={closeMenu}
          aria-label="Ayaka 首页"
        >
          <img
            className="size-7 rounded-sm object-cover transition-transform duration-300 group-hover:rotate-6"
            src="/favicon.png"
            alt=""
            aria-hidden="true"
          />
          <span className="text-sm font-semibold tracking-[0.2em]">AYAKA</span>
        </a>

        <nav className="hidden items-center gap-8 text-xs tracking-[0.08em] text-paper/60 lg:flex">
          <a className="transition-colors hover:text-paper" href={sectionHref("capabilities")}>
            能力
          </a>
          <a className="transition-colors hover:text-paper" href={sectionHref("trace")}>
            运行轨迹
          </a>
          <a className="transition-colors hover:text-paper" href={sectionHref("boundary")}>
            本地边界
          </a>
        </nav>

        <div className="flex items-center gap-4">
          <span className="hidden font-mono text-[0.65rem] uppercase tracking-[0.14em] text-paper/45 sm:inline">
            中文 / 本地
          </span>
          <a
            className="hidden border-b border-signal/70 pb-1 text-xs font-medium tracking-[0.08em] text-signal transition-colors hover:border-paper hover:text-paper sm:inline"
            href="/download"
          >
            下载
          </a>
          <button
            className="grid size-10 place-items-center border border-paper/20 text-paper transition-colors hover:border-paper lg:hidden"
            type="button"
            aria-expanded={isMenuOpen}
            aria-controls="mobile-nav"
            aria-label={isMenuOpen ? "关闭菜单" : "打开菜单"}
            onClick={() => setIsMenuOpen((open) => !open)}
          >
            {isMenuOpen ? <X aria-hidden="true" /> : <Menu aria-hidden="true" />}
          </button>
        </div>
      </div>

      <nav
        id="mobile-nav"
        className={cn(
          "mx-auto grid max-w-[1440px] origin-top gap-1 overflow-hidden border-x border-b border-paper/15 bg-carbon px-5 transition-[grid-template-rows,opacity] duration-300 lg:hidden",
          isMenuOpen
            ? "grid-rows-[1fr] opacity-100"
            : "pointer-events-none grid-rows-[0fr] opacity-0",
        )}
        aria-hidden={!isMenuOpen}
        inert={!isMenuOpen}
      >
        <div className="min-h-0">
          {[
            ["能力", sectionHref("capabilities")],
            ["运行轨迹", sectionHref("trace")],
            ["本地边界", sectionHref("boundary")],
            ["下载", "/download"],
          ].map(([label, href]) => (
            <a
              className="flex items-center justify-between border-b border-paper/10 py-4 text-sm tracking-[0.06em] text-paper/70 transition-colors hover:text-paper"
              href={href}
              key={href}
              onClick={closeMenu}
            >
              {label}
              <ArrowUpRight aria-hidden="true" />
            </a>
          ))}
        </div>
      </nav>
    </header>
  );
}

function HeroWorkspacePreview() {
  return (
    <div
      className="relative mx-auto w-full max-w-[680px] rotate-[1deg] lg:rotate-[-1deg]"
      aria-label="Ayaka 工作台预览"
    >
      <div className="overflow-hidden border border-paper/20 bg-paper p-2 text-carbon shadow-lg shadow-black/20 sm:p-3">
        <div className="flex h-10 items-center gap-3 border-b border-carbon/10 px-2 font-mono text-[0.58rem] uppercase tracking-[0.12em] text-carbon/50 sm:px-3">
          <span className="flex gap-1.5" aria-hidden="true">
            <i className="size-1.5 rounded-full bg-coral" />
            <i className="size-1.5 rounded-full bg-carbon/30" />
            <i className="size-1.5 rounded-full bg-mint" />
          </span>
          <span>Ayaka / 实时工作台</span>
          <span className="ml-auto text-mint">真实截图</span>
        </div>
        <img
          className="block h-auto w-full"
          src="/example.png"
          alt="Ayaka 桌面工作台运行状态截图"
          width={2880}
          height={1716}
          fetchPriority="high"
          decoding="async"
        />
      </div>

      <div className="absolute -bottom-5 -left-5 border border-signal/60 bg-carbon px-3 py-2 font-mono text-[0.55rem] uppercase tracking-[0.14em] text-signal shadow-xl shadow-black/20">
        <span className="mr-2 inline-block size-1.5 rounded-full bg-signal align-middle" />
        内测版本即将上线
      </div>
    </div>
  );
}

function DownloadAction({
  releaseData,
  children,
  tone = "light",
}: {
  releaseData: ReleasePageData;
  children: ReactNode;
  tone?: "light" | "dark";
}) {
  if (releaseData.status !== "available") {
    return (
      <BracketLink href="/download" tone={tone}>
        获取 Ayaka
      </BracketLink>
    );
  }

  return (
    <BracketLink href={releaseData.release.downloadUrl} tone={tone} external>
      {children}
    </BracketLink>
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

function Hero({ releaseData }: { releaseData: ReleasePageData }) {
  return (
    <section
      className="relative isolate min-h-svh overflow-hidden bg-carbon pb-12 pt-32 text-paper md:pt-40"
      id="top"
    >
      <div className="pointer-events-none absolute inset-0 -z-10 bg-grid-carbon opacity-70" />

      <div className="mx-auto grid min-h-[calc(100svh-3rem)] max-w-[1440px] grid-rows-[auto_1fr_auto] gap-12 px-5 md:px-10">
        <div className="flex items-center justify-between border-b border-paper/15 pb-4 font-mono text-[0.65rem] uppercase tracking-[0.16em] text-paper/55">
          <span>Ayaka · 有情感连续性的关系</span>
          <span className="hidden sm:inline">数字生命体 / 001</span>
        </div>

        <div className="grid items-center gap-16 py-14 lg:grid-cols-[0.85fr_1.15fr] lg:gap-20">
          <div className="max-w-xl">
            <p className="mb-7 flex items-center gap-3 font-mono text-[0.68rem] uppercase tracking-[0.16em] text-signal">
              <span className="size-2 rounded-full border border-signal bg-signal/40" />
              私人、主动、能延续关系 / 陪伴型 AI 智能
            </p>
            <h1 className="max-w-[11ch] text-[clamp(3.8rem,8vw,7.5rem)] font-semibold leading-[0.9] tracking-[-0.08em]">
              Ayaka
            </h1>
            <p className="mt-8 max-w-[40ch] text-base leading-8 text-paper/65 sm:text-lg">
              是对「数字生命体」路线的产品化实验
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-6">
              <DownloadAction releaseData={releaseData}>下载 Ayaka</DownloadAction>
              <a
                className="group inline-flex items-center gap-2 font-mono text-[0.68rem] uppercase tracking-[0.14em] text-paper/60 transition-colors hover:text-paper"
                href="#capabilities"
              >
                查看运行方式
                <span className="transition-transform duration-300 group-hover:translate-y-1">
                  ↓
                </span>
              </a>
            </div>
          </div>

          <HeroWorkspacePreview />
        </div>

        <div className="flex flex-wrap justify-between gap-x-6 gap-y-2 border-t border-paper/15 pt-5 font-mono text-[0.6rem] uppercase tracking-[0.12em] text-paper/45">
          <span>对话 → 智能体 → 记忆 → 工具</span>
          <span className="sm:text-center">默认可追踪</span>
          <span className="sm:text-right">Windows x64 已可用</span>
        </div>
      </div>
    </section>
  );
}

function CapabilitiesSection() {
  return (
    <section className="bg-paper py-28 text-carbon md:py-40" id="capabilities">
      <div className="mx-auto max-w-[1440px] px-5 md:px-10">
        <div className="grid gap-10 border-b border-carbon/15 pb-12 lg:grid-cols-[1.4fr_0.6fr] lg:items-end">
          <div>
            <SectionKicker>01 / 单一链路</SectionKicker>
            <h2 className="mt-6 max-w-4xl text-[clamp(2.8rem,6vw,6rem)] font-semibold leading-[0.95] tracking-[-0.07em]">
              四个入口，
              <br />
              一条运行链路。
            </h2>
          </div>
          <p className="max-w-md text-base leading-8 text-graphite">
            在连接成本上升、精神陪伴需求抬升的背景下，Ayaka
            构建的不是「更全的知识库」，而是「私人、主动、能延续关系」的数字存在。
          </p>
        </div>

        <div className="mt-12 divide-y border-y border-carbon/15">
          {CAPABILITIES.map((capability) => (
            <article
              className="group grid gap-5 py-7 transition-colors duration-300 hover:bg-carbon hover:text-paper sm:grid-cols-[4rem_0.85fr_1.15fr_auto] sm:items-start sm:px-5"
              key={capability.index}
            >
              <span className="font-mono text-xs text-coral">{capability.index}</span>
              <div>
                <p className="text-sm font-medium tracking-tight text-graphite transition-colors group-hover:text-paper/60">
                  {capability.label}
                </p>
                <h3 className="mt-2 text-2xl font-semibold tracking-[-0.04em]">
                  {capability.title}
                </h3>
              </div>
              <p className="max-w-xl text-sm leading-7 text-graphite transition-colors group-hover:text-paper/65">
                {capability.description}
              </p>
              <ArrowUpRight
                aria-hidden="true"
                className="text-graphite transition-transform duration-300 group-hover:translate-x-1 group-hover:text-paper"
              />
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

function RunTraceSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const [activeStep, setActiveStep] = useState(0);

  useEffect(() => {
    const root = sectionRef.current;
    if (!root || !("IntersectionObserver" in window)) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const steps = Array.from(root.querySelectorAll<HTMLElement>("[data-trace-step]"));
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((left, right) => right.intersectionRatio - left.intersectionRatio)[0];
        if (!visible) return;
        const nextStep = Number(visible.target.getAttribute("data-trace-step"));
        if (Number.isFinite(nextStep)) setActiveStep(nextStep);
      },
      { rootMargin: "-35% 0px -35% 0px", threshold: [0.2, 0.5, 0.8] },
    );

    steps.forEach((step) => observer.observe(step));
    return () => observer.disconnect();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative overflow-hidden bg-carbon py-28 text-paper md:py-40"
      id="trace"
    >
      <div className="pointer-events-none absolute inset-0 -z-0 bg-grid-carbon opacity-35" />
      <div className="relative z-10 mx-auto grid max-w-[1440px] gap-16 px-5 md:px-10 lg:grid-cols-[0.72fr_1.28fr] lg:gap-24">
        <div className="lg:sticky lg:top-28 lg:h-fit">
          <SectionKicker light>02 / 运行轨迹</SectionKicker>
          <h2 className="mt-6 max-w-2xl text-[clamp(2.8rem,6vw,5.8rem)] font-semibold leading-[0.95] tracking-[-0.07em]">
            过程不藏在
            <br />
            <span className="text-signal">幕后。</span>
          </h2>
          <p className="mt-8 max-w-md text-base leading-8 text-paper/60">
            每个智能体循环都有自己的轨迹。你知道发生了什么，也知道下一步是什么。
          </p>

          <div className="mt-12 hidden items-center gap-4 lg:flex">
            <div className="relative h-40 w-px bg-paper/15">
              <span
                className="absolute left-0 top-0 w-px bg-signal transition-[height] duration-700"
                style={{ height: ((activeStep + 1) / TRACE_STEPS.length) * 100 + "%" }}
              />
              <span
                className="absolute -left-1.5 size-3 rounded-full border border-signal bg-carbon transition-[top] duration-700"
                style={{
                  top: "calc(" + (activeStep / (TRACE_STEPS.length - 1)) * 100 + "% - 0.375rem)",
                }}
              />
            </div>
            <div className="font-mono text-[0.62rem] uppercase tracking-[0.14em] text-paper/45">
              <span className="text-signal">0{activeStep + 1}</span> / 05 active
            </div>
          </div>
        </div>

        <div className="relative">
          <div className="absolute bottom-8 left-4 top-8 w-px bg-paper/15 sm:left-6" />
          <div
            className="absolute left-4 top-8 w-px bg-signal transition-[height] duration-700 sm:left-6"
            style={{ height: "calc(" + (activeStep / TRACE_STEPS.length) * 100 + "% + 3rem)" }}
          />
          <div className="flex flex-col gap-4">
            {TRACE_STEPS.map((step, index) => {
              const isActive = index === activeStep;
              return (
                <article
                  className={cn(
                    "relative grid grid-cols-[2rem_minmax(0,1fr)] gap-6 border border-paper/10 p-6 transition-all duration-500 sm:grid-cols-[3rem_minmax(0,1fr)] sm:gap-8 sm:p-8",
                    isActive && "border-signal/60 bg-paper/[0.04] motion-safe:sm:translate-x-2",
                  )}
                  data-trace-step={index}
                  key={step.index}
                >
                  <div
                    className={cn(
                      "relative z-10 grid size-8 place-items-center rounded-full border border-paper/25 bg-carbon font-mono text-[0.62rem] text-paper/50 transition-colors sm:size-12",
                      isActive && "border-signal text-signal",
                    )}
                  >
                    {isActive ? <CircleDot aria-hidden="true" /> : step.index}
                  </div>
                  <div>
                    <p
                      className={cn(
                        "font-mono text-[0.65rem] uppercase tracking-[0.16em]",
                        step.tone === "signal" && "text-signal",
                        step.tone === "mint" && "text-mint",
                        step.tone === "coral" && "text-coral",
                      )}
                    >
                      {step.label}
                    </p>
                    <h3 className="mt-4 text-2xl font-semibold tracking-[-0.04em] sm:text-4xl">
                      {step.title}
                    </h3>
                    <p className="mt-4 max-w-lg text-sm leading-7 text-paper/55 sm:text-base">
                      {step.description}
                    </p>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

function WorkspaceSection() {
  return (
    <section className="bg-mist py-28 text-carbon md:py-40" id="workspace">
      <div className="mx-auto max-w-[1440px] px-5 md:px-10">
        <div className="grid gap-10 lg:grid-cols-[0.7fr_1.3fr] lg:items-end">
          <div>
            <SectionKicker>03 / 工作台</SectionKicker>
            <h2 className="mt-6 text-[clamp(2.8rem,5vw,5rem)] font-semibold leading-[0.95] tracking-[-0.07em]">
              一座工作台，
              <br />
              四种行动方式。
            </h2>
          </div>
          <p className="max-w-lg text-base leading-8 text-graphite">
            对话是入口，智能体负责行动，记忆保留上下文，工具 连接外部世界。它们共享一条运行记录。
          </p>
        </div>

        <div className="mt-16 grid gap-8 border-y border-carbon/15 py-8 lg:grid-cols-[0.82fr_1.18fr] lg:gap-14 lg:py-14">
          <div className="flex flex-col justify-between gap-10">
            {[
              ["对话", "让一句话成为下一步。"],
              ["智能体", "让复杂任务可以分工。"],
              ["记忆", "让上下文在本地接续。"],
              ["工具", "让能力按需进入运行。"],
            ].map(([label, title], index) => (
              <div
                className="group flex gap-5 border-b border-carbon/10 pb-6 last:border-b-0"
                key={label}
              >
                <span className="font-mono text-xs text-coral">0{index + 1}</span>
                <div>
                  <p className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-graphite">
                    {label}
                  </p>
                  <h3 className="mt-2 text-xl font-semibold tracking-[-0.04em] transition-transform duration-300 group-hover:translate-x-1">
                    {title}
                  </h3>
                </div>
              </div>
            ))}
          </div>

          <div className="relative min-h-[390px] overflow-hidden border border-carbon/15 bg-paper p-5 sm:p-8">
            <div className="absolute inset-0 bg-grid-paper opacity-70" />
            <div className="relative flex h-full flex-col justify-between gap-8">
              <div className="flex items-center justify-between border-b border-carbon/15 pb-4 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-graphite">
                <span>对话 / 进行中</span>
                <span className="text-mint">本地状态</span>
              </div>
              <div className="grid gap-4 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
                <div className="border border-carbon/15 bg-mist p-4">
                  <p className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-graphite">
                    输入
                  </p>
                  <p className="mt-4 text-sm leading-6">整理这周的项目线索</p>
                </div>
                <div className="hidden font-mono text-xl text-signal sm:block">→</div>
                <div className="border border-signal/40 bg-signal/[0.06] p-4">
                  <p className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-signal">
                    智能体循环
                  </p>
                  <div className="mt-4 flex flex-wrap gap-2 font-mono text-[0.58rem] uppercase tracking-[0.08em] text-carbon/60">
                    <span className="border border-carbon/15 px-2 py-1">记忆</span>
                    <span className="border border-carbon/15 px-2 py-1">工具</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 border-t border-carbon/15 pt-4 font-mono text-[0.62rem] uppercase tracking-[0.12em] text-graphite">
                <span className="size-2 rounded-full bg-signal" />
                <span>运行事件已记录</span>
                <span className="ml-auto text-carbon/40">可追踪</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function BoundarySection() {
  return (
    <section className="relative overflow-hidden bg-carbon py-28 text-paper md:py-40" id="boundary">
      <div className="pointer-events-none absolute inset-0 -z-0 bg-grid-carbon opacity-30" />
      <div className="relative z-10 mx-auto max-w-[1440px] px-5 md:px-10">
        <div className="grid gap-10 border-b border-paper/15 pb-12 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
          <div>
            <SectionKicker light>04 / 默认本地</SectionKicker>
            <h2 className="mt-6 max-w-2xl text-[clamp(2.8rem,6vw,6rem)] font-semibold leading-[0.95] tracking-[-0.07em]">
              你的工作空间，
              <br />
              <span className="text-mint">不必先离开设备。</span>
            </h2>
          </div>
          <p className="max-w-lg text-base leading-8 text-paper/60">
            Ayaka 的默认姿态是本地优先。桌面端负责文件、数据库、密钥、MCP
            连接和运行记录；渲染层只通过明确的桥接访问它们。
          </p>
        </div>

        <div className="mt-12 divide-y border-y border-paper/15">
          {BOUNDARIES.map((boundary) => {
            return (
              <article
                className="group grid gap-5 py-7 transition-colors duration-300 hover:bg-paper/[0.04] sm:grid-cols-[4rem_0.85fr_1.15fr_auto] sm:items-start sm:px-5"
                key={boundary.index}
              >
                <span className="font-mono text-xs text-coral">{boundary.index}</span>
                <h3 className="text-2xl font-semibold tracking-[-0.04em]">{boundary.title}</h3>
                <p className="text-sm leading-7 text-paper/55">{boundary.description}</p>
                <p className="font-mono text-[0.62rem] tracking-[0.12em] text-mint">
                  {boundary.status}
                </p>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function DownloadBanner({ releaseData }: { releaseData: ReleasePageData }) {
  const summary = releaseData.status === "available" ? releaseSummary(releaseData.release) : null;

  return (
    <section className="bg-paper py-20 text-carbon md:py-28" id="download">
      <div className="mx-auto grid max-w-[1440px] gap-10 px-5 md:px-10 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <SectionKicker>05 / 开始本地运行</SectionKicker>
          <h2 className="mt-6 max-w-3xl text-[clamp(2.8rem,5vw,5.2rem)] font-semibold leading-[0.95] tracking-[-0.07em]">
            现在，给 Ayaka
            <br />
            一个任务。
          </h2>
          <p className="mt-6 max-w-xl text-base leading-8 text-graphite">
            不是一次性问答工具，也不是百科型客服，而是在本地、私密、可长期运行的前提下，验证 AI
            能否形成 有情感连续性的陪伴关系。
          </p>
          {summary && (
            <p className="mt-5 font-mono text-[0.62rem] uppercase tracking-[0.14em] text-graphite">
              {summary.version} / {summary.date} / {summary.size}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-5">
          <DownloadAction releaseData={releaseData} tone="dark">
            下载最新版本
          </DownloadAction>
          <a
            className="text-sm font-medium tracking-tight text-graphite transition-colors hover:text-carbon"
            href="/download"
          >
            查看平台信息 →
          </a>
        </div>
      </div>
    </section>
  );
}

export function SiteFooter({ homePath = "" }: { homePath?: string }) {
  return (
    <footer className="border-t border-paper/15 bg-carbon py-14 text-paper">
      <div className="mx-auto grid max-w-[1440px] gap-12 px-5 md:px-10 lg:grid-cols-[1fr_auto_auto] lg:items-end">
        <div>
          <div className="flex items-center gap-3">
            <img
              className="size-8 rounded-sm object-cover"
              src="/favicon.png"
              alt=""
              aria-hidden="true"
            />
            <span className="text-sm font-semibold tracking-[0.2em]">AYAKA</span>
          </div>
          <p className="mt-5 max-w-sm text-sm leading-7 text-paper/55">
            对「数字生命体」路线的产品化实验
          </p>
        </div>
        <nav className="flex flex-col gap-3 text-sm tracking-tight text-paper/55">
          <a className="transition-colors hover:text-paper" href="/download">
            下载
          </a>
          <a
            className="transition-colors hover:text-paper"
            href={homePath ? `${homePath}#top` : "#top"}
          >
            返回顶部
          </a>
        </nav>
        <div className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-paper/35 lg:text-right">
          <p>默认本地运行</p>
          <p className="mt-2">MIT 许可证 · © 2026 ZZZVoid</p>
        </div>
      </div>
    </footer>
  );
}

export function SiteHome({ releaseData }: { releaseData: ReleasePageData }) {
  const resolvedReleaseData = useReleaseData(releaseData);

  return (
    <main className="min-h-screen overflow-clip bg-carbon">
      <SiteHeader />
      <Hero releaseData={resolvedReleaseData} />
      <CapabilitiesSection />
      <RunTraceSection />
      <WorkspaceSection />
      <BoundarySection />
      <DownloadBanner releaseData={resolvedReleaseData} />
      <SiteFooter />
    </main>
  );
}

export { BracketLink, DownloadAction };

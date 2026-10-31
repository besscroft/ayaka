import type { CSSProperties } from "react";
import { Clock3, Download, ShieldCheck } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { releaseSummary } from "@/lib/release-format";
import type { ReleasePageData } from "@/lib/release-client";
import {
  Bubble,
  DownloadAction,
  SiteFooter,
  SiteHeader,
  useReleaseData,
  useReveal,
} from "./site-home";

function revealDelay(ms: number): CSSProperties {
  return { "--reveal-delay": `${ms}ms` } as CSSProperties;
}

function ReleaseUnavailable({
  releaseData,
}: {
  releaseData: Extract<ReleasePageData, { status: "unavailable" }>;
}) {
  const message =
    releaseData.reason === "not-found"
      ? "当前还没有可用的 Windows 发布包。"
      : "暂时无法读取最新 Windows 发布包。";

  return (
    <div className="rounded-2xl border border-line bg-card p-8 shadow-card sm:p-10">
      <p className="text-sm font-medium text-ink-soft">暂无可用发布包</p>
      <p className="mt-3 text-xl font-semibold text-ink">{message}</p>
      <p className="mt-3 max-w-xl text-sm leading-7 text-ink-soft">
        你可以稍后重新打开此页面，服务恢复后会在这里显示最新安装包。
      </p>
    </div>
  );
}

function ReleaseCard({
  releaseData,
}: {
  releaseData: Extract<ReleasePageData, { status: "available" }>;
}) {
  const summary = releaseSummary(releaseData.release);

  return (
    <article className="rounded-2xl border border-line bg-card p-8 shadow-card sm:p-10">
      <div className="flex items-start justify-between gap-6">
        <p className="inline-flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1 text-xs font-medium text-ink">
          <span className="size-1.5 rounded-full bg-live" />
          稳定版 · 可用
        </p>
        <ShieldCheck aria-hidden="true" className="size-5 text-ink-soft" />
      </div>

      <h3 className="mt-5 text-4xl font-bold tnum text-ink">{summary.version}</h3>

      <div className="mt-8 grid grid-cols-2 gap-x-8 gap-y-5 border-t border-line-soft pt-8 sm:grid-cols-3">
        {[
          ["平台", "Windows x64"],
          ["安装包", summary.size],
          ["发布日期", summary.date],
          ["渠道", releaseData.release.channel],
        ].map(([label, value]) => (
          <div key={label}>
            <p className="text-xs text-ink-soft">{label}</p>
            <p className="mt-1.5 text-sm font-semibold tnum">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-9 flex flex-wrap items-center gap-4">
        <DownloadAction releaseData={releaseData}>
          <Download aria-hidden="true" className="size-4" />
          下载 Windows 版本
        </DownloadAction>
        <span className="text-xs text-ink-soft">.exe 安装包 · SHA-512 已提供</span>
      </div>

      <Accordion className="mt-8 border-t border-line-soft pt-2" defaultValue={["release-details"]}>
        <AccordionItem value="release-details" className="border-line-soft">
          <AccordionTrigger className="py-3 text-sm font-semibold text-ink hover:no-underline">
            查看版本详情
          </AccordionTrigger>
          <AccordionContent className="pb-4 text-ink-soft">
            <dl className="grid gap-4 text-sm sm:grid-cols-[auto_1fr]">
              <dt className="text-xs text-ink-soft">SHA-512</dt>
              <dd className="break-all font-mono text-xs">{releaseData.release.sha512}</dd>
              <dt className="text-xs text-ink-soft">更新元数据</dt>
              <dd>
                <a
                  className="font-medium text-ink underline decoration-line underline-offset-4 transition-colors hover:decoration-ink"
                  href={releaseData.release.metadataUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  latest.yml
                </a>
              </dd>
            </dl>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </article>
  );
}

const INSTALL_STEPS = ["下载 Windows 安装包", "完成本地安装", "打开 Ayaka，说第一句话"] as const;

export function SiteDownload({ releaseData }: { releaseData: ReleasePageData }) {
  const resolvedReleaseData = useReleaseData(releaseData);
  useReveal();

  return (
    <main className="bg-paper text-ink">
      <SiteHeader homePath="/" />

      <section className="bg-paper pt-20 md:pt-28">
        <div className="mx-auto grid max-w-[1200px] gap-12 px-5 pb-16 md:px-8 md:pb-24 lg:grid-cols-[1.2fr_0.8fr] lg:items-end">
          <div className="hero-rise max-w-xl">
            <h1 className="text-[clamp(2.5rem,4.5vw,4rem)] font-bold leading-[1.06] tracking-[-0.01em] text-balance text-ink">
              把 Ayaka <span className="text-ink-faint">带回家。</span>
            </h1>
            <p className="mt-6 max-w-[34em] text-base leading-8 text-ink-soft">
              Windows x64 已经就绪。macOS 和 Linux 会在准备好之后加入——这里不会出现虚假的下载入口。
            </p>
            <div className="mt-8">
              {resolvedReleaseData.status === "available" ? (
                <span className="inline-flex items-center gap-2.5 rounded-full border border-line bg-card px-4 py-2 text-sm font-medium text-ink shadow-card">
                  <span className="presence-dot size-2 rounded-full bg-live" />
                  Windows x64 · v{resolvedReleaseData.release.version} 已就绪
                </span>
              ) : (
                <span className="inline-flex items-center gap-2.5 rounded-full border border-line bg-card px-4 py-2 text-sm font-medium text-ink-soft shadow-card">
                  <span className="size-2 rounded-full bg-ink-faint" />
                  Windows x64 · 暂无可用发布包
                </span>
              )}
            </div>
          </div>

          <div className="relative flex items-end gap-4 lg:justify-end">
            <div className="hero-pop" style={{ animationDelay: "160ms" }}>
              <div className="breathe w-28 overflow-hidden rounded-xl border border-line bg-card shadow-float sm:w-32">
                <img
                  className="block h-auto w-full"
                  src="/favicon.png"
                  alt="Ayaka 的形象：黑白漫画风格的马尾少女"
                  width={1240}
                  height={1240}
                  decoding="async"
                />
              </div>
            </div>
            <div className="hero-pop" style={{ animationDelay: "280ms" }}>
              <Bubble>我的行李很简单，一个安装包就好。</Bubble>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-paper pb-24 scroll-mt-16 md:pb-32" id="windows">
        <div className="mx-auto max-w-[1200px] px-5 md:px-8">
          <div className="grid gap-10 lg:grid-cols-[1.25fr_0.75fr] lg:gap-14">
            <div data-reveal>
              {resolvedReleaseData.status === "available" ? (
                <ReleaseCard releaseData={resolvedReleaseData} />
              ) : (
                <ReleaseUnavailable releaseData={resolvedReleaseData} />
              )}
            </div>

            <div
              className="flex flex-col justify-center"
              data-reveal={true}
              style={revealDelay(120)}
            >
              <h2 className="text-xl font-semibold">安装三步</h2>
              <ol className="mt-7 flex flex-col">
                {INSTALL_STEPS.map((step, index) => (
                  <li className="relative flex gap-4 pb-8 last:pb-0" key={step}>
                    <div className="flex flex-col items-center">
                      <span
                        className={
                          index === 0
                            ? "grid size-9 shrink-0 place-items-center rounded-full bg-ink text-sm font-semibold text-paper tnum"
                            : "grid size-9 shrink-0 place-items-center rounded-full border border-line bg-card text-sm font-semibold text-ink-soft tnum"
                        }
                      >
                        {index + 1}
                      </span>
                      {index < INSTALL_STEPS.length - 1 && (
                        <span aria-hidden="true" className="mt-1.5 w-px flex-1 bg-line" />
                      )}
                    </div>
                    <p className="pt-2 text-sm font-medium leading-6">{step}</p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-paper py-20 md:py-28">
        <div className="mx-auto max-w-[1200px] px-5 md:px-8">
          <div data-reveal>
            <h2 className="max-w-lg text-[clamp(1.75rem,3vw,2.5rem)] font-bold leading-[1.16] tracking-[-0.01em] text-balance">
              其他平台，在准备的路上。
            </h2>
            <p className="mt-4 max-w-[34em] text-base leading-8 text-ink-soft">
              构建准备好后会第一时间出现在这里，页面上不会提供不可用的下载地址。
            </p>
          </div>

          <div
            className="mt-10 rounded-2xl border border-line bg-card px-7 py-2 shadow-card sm:px-9"
            data-reveal={true}
            style={revealDelay(120)}
          >
            {[
              ["macOS", "Apple Silicon / Intel"],
              ["Linux", "x64 / arm64"],
            ].map(([label, platform], index) => (
              <div
                className={
                  index === 0
                    ? "flex flex-wrap items-center gap-x-6 gap-y-2 py-6"
                    : "flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-line-soft py-6"
                }
                key={label}
              >
                <h3 className="w-24 text-lg font-semibold">{label}</h3>
                <p className="flex-1 text-sm text-ink-soft">{platform}</p>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-2.5 py-0.5 text-xs font-medium text-ink-soft">
                  <Clock3 aria-hidden="true" className="size-3.5" />
                  准备中
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="bg-paper py-20 md:py-28">
        <div className="mx-auto grid max-w-[1200px] gap-10 px-5 md:px-8 lg:grid-cols-[0.7fr_1.3fr]">
          <div data-reveal>
            <h2 className="max-w-xs text-[clamp(1.75rem,3vw,2.5rem)] font-bold leading-[1.16] tracking-[-0.01em] text-balance">
              下载前，先知道边界。
            </h2>
          </div>
          <div
            className="rounded-2xl border border-line bg-card px-7 py-3 shadow-card sm:px-9"
            data-reveal={true}
            style={revealDelay(120)}
          >
            <Accordion defaultValue={["local"]}>
              <AccordionItem value="local" className="border-line-soft">
                <AccordionTrigger className="py-5 text-left text-base font-semibold text-ink hover:no-underline">
                  数据默认留在本机
                </AccordionTrigger>
                <AccordionContent className="pb-6 text-sm leading-7 text-ink-soft">
                  Ayaka 的文件、SQLite 数据和运行记录默认留在本机；Provider、MCP 和 Skill secrets
                  在主进程边界内解析。
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="trace" className="border-line-soft">
                <AccordionTrigger className="py-5 text-left text-base font-semibold text-ink hover:no-underline">
                  每次运行都有记录
                </AccordionTrigger>
                <AccordionContent className="pb-6 text-sm leading-7 text-ink-soft">
                  Agent 运行、工具调用、审批和错误状态会写入本地运行表，方便复盘、诊断和重新接管。
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </div>
      </section>

      <SiteFooter homePath="/" />
    </main>
  );
}

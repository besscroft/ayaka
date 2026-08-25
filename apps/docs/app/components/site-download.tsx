import { Check, Clock3, Download, ShieldCheck } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Separator } from "@/components/ui/separator";
import { releaseSummary } from "@/lib/release-format";
import type { ReleasePageData } from "@/lib/release-client";
import { DownloadAction, SiteFooter, SiteHeader, useReleaseData } from "./site-home";

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
    <div className="border border-coral/40 bg-coral/5 p-6 text-carbon sm:p-8">
      <p className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-coral">
        暂无可用发布包
      </p>
      <p className="mt-4 text-lg font-semibold tracking-tight">{message}</p>
      <p className="mt-3 max-w-xl text-sm leading-7 text-graphite">
        你可以稍后重新打开此页面，服务恢复后会在这里显示最新安装包。
      </p>
    </div>
  );
}

function PlatformCard({
  label,
  platform,
  status,
  description,
}: {
  label: string;
  platform: string;
  status: "available" | "planned";
  description: string;
}) {
  return (
    <article className="flex min-h-64 flex-col border border-carbon/15 bg-mist p-6 sm:p-8">
      <div className="flex items-start justify-between gap-4">
        <span className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-graphite">
          {platform}
        </span>
        {status === "available" ? (
          <span className="flex items-center gap-2 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-mint">
            <Check aria-hidden="true" />
            可用
          </span>
        ) : (
          <span className="flex items-center gap-2 font-mono text-[0.6rem] uppercase tracking-[0.14em] text-coral">
            <Clock3 aria-hidden="true" />
            后续提供
          </span>
        )}
      </div>
      <h3 className="mt-auto text-3xl font-semibold tracking-[-0.05em]">{label}</h3>
      <p className="mt-4 text-sm leading-7 text-graphite">{description}</p>
    </article>
  );
}

export function SiteDownload({ releaseData }: { releaseData: ReleasePageData }) {
  const resolvedReleaseData = useReleaseData(releaseData);
  const summary =
    resolvedReleaseData.status === "available" ? releaseSummary(resolvedReleaseData.release) : null;

  return (
    <main className="min-h-screen overflow-clip bg-paper text-carbon">
      <SiteHeader homePath="/" />

      <section className="bg-carbon pb-24 pt-36 text-paper md:pb-32 md:pt-48">
        <div className="mx-auto grid max-w-[1440px] gap-12 px-5 md:px-10 lg:grid-cols-[1fr_0.8fr] lg:items-end">
          <div>
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-signal">
              01 / 发布渠道
            </p>
            <h1 className="mt-7 max-w-4xl text-[clamp(3.7rem,8vw,7.5rem)] font-semibold leading-[0.88] tracking-[-0.08em]">
              开始在本地
              <br />
              <span className="text-signal">运行。</span>
            </h1>
          </div>
          <div className="border-t border-paper/15 pt-5 text-base leading-8 text-paper/60">
            <p>
              {resolvedReleaseData.status === "available"
                ? "现在只有 Windows x64 构建可用。macOS 和 Linux 版本会在准备好之后加入，不会显示虚假的下载入口。"
                : "Windows x64 当前暂时没有可下载的发布包。macOS 和 Linux 版本会在准备好之后加入，不会显示虚假的下载入口。"}
            </p>
          </div>
        </div>
      </section>

      <section className="py-20 md:py-32" id="windows">
        <div className="mx-auto max-w-[1440px] px-5 md:px-10">
          <div className="flex flex-wrap items-end justify-between gap-6 border-b border-carbon/15 pb-8">
            <div>
              <p className="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-graphite">
                02 / WINDOWS
              </p>
              <h2 className="mt-5 text-4xl font-semibold tracking-[-0.06em] sm:text-6xl">
                Windows x64
              </h2>
            </div>
            {summary && (
              <p className="font-mono text-[0.65rem] uppercase tracking-[0.14em] text-graphite">
                {summary.version} / {summary.date}
              </p>
            )}
          </div>

          <div className="mt-10 grid gap-10 lg:grid-cols-[1.2fr_0.8fr]">
            {resolvedReleaseData.status === "available" ? (
              <article className="border border-carbon/20 bg-mist p-6 sm:p-10">
                <div className="flex items-start justify-between gap-6">
                  <div>
                    <p className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-mint">
                      稳定版 / 可用
                    </p>
                    <h3 className="mt-5 text-3xl font-semibold tracking-[-0.05em]">
                      Ayaka {summary?.version}
                    </h3>
                  </div>
                  <ShieldCheck aria-hidden="true" className="text-mint" />
                </div>

                <Separator className="my-8 bg-carbon/15" />

                <div className="flex flex-wrap gap-x-10 gap-y-5">
                  {[
                    ["平台", "Windows x64"],
                    ["安装包", summary?.size ?? "—"],
                    ["渠道", resolvedReleaseData.release.channel],
                  ].map(([label, value]) => (
                    <div key={label}>
                      <p className="font-mono text-[0.6rem] uppercase tracking-[0.14em] text-graphite">
                        {label}
                      </p>
                      <p className="mt-2 text-sm font-semibold">{value}</p>
                    </div>
                  ))}
                </div>

                <div className="mt-10 flex flex-wrap items-center gap-6">
                  <DownloadAction releaseData={resolvedReleaseData} tone="dark">
                    <Download aria-hidden="true" />
                    下载 Windows 版本
                  </DownloadAction>
                  <span className="font-mono text-[0.6rem] uppercase tracking-[0.12em] text-graphite">
                    .exe 安装包
                  </span>
                </div>

                <Accordion
                  className="mt-10 border-t border-carbon/15 pt-2"
                  defaultValue={["release-details"]}
                >
                  <AccordionItem value="release-details">
                    <AccordionTrigger className="py-4 text-carbon hover:no-underline">
                      查看版本详情
                    </AccordionTrigger>
                    <AccordionContent className="pb-5 text-graphite">
                      <dl className="grid gap-4 text-sm sm:grid-cols-[auto_1fr]">
                        <dt className="font-mono text-[0.6rem] uppercase tracking-[0.12em]">
                          SHA-512
                        </dt>
                        <dd className="break-all font-mono text-xs">
                          {resolvedReleaseData.release.sha512}
                        </dd>
                        <dt className="font-mono text-[0.6rem] uppercase tracking-[0.12em]">
                          更新元数据
                        </dt>
                        <dd>
                          <a
                            className="underline decoration-carbon/25 underline-offset-4 hover:decoration-carbon"
                            href={resolvedReleaseData.release.metadataUrl}
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
            ) : (
              <ReleaseUnavailable releaseData={resolvedReleaseData} />
            )}

            <div className="flex flex-col justify-between gap-8 border-l border-carbon/15 pl-6 sm:pl-10">
              <div>
                <p className="font-mono text-[0.65rem] uppercase tracking-[0.16em] text-graphite">
                  安装流程
                </p>
                <h3 className="mt-5 max-w-sm text-3xl font-semibold leading-tight tracking-[-0.05em]">
                  下载、安装，然后从一句话开始。
                </h3>
              </div>
              <ol className="flex flex-col gap-6">
                {[
                  ["01", "下载 Windows 安装包"],
                  ["02", "完成本地安装"],
                  ["03", "打开 Ayaka，开始一次运行"],
                ].map(([index, label]) => (
                  <li className="flex items-start gap-4" key={index}>
                    <span className="font-mono text-xs text-coral">{index}</span>
                    <span className="text-sm leading-6 text-graphite">{label}</span>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      <section className="bg-mist py-20 md:py-28">
        <div className="mx-auto max-w-[1440px] px-5 md:px-10">
          <div className="border-b border-carbon/15 pb-8">
            <p className="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-graphite">
              03 / 平台计划
            </p>
            <h2 className="mt-5 max-w-3xl text-4xl font-semibold leading-[0.95] tracking-[-0.06em] sm:text-6xl">
              其他平台，
              <br />
              等待进入运行链路。
            </h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            <PlatformCard
              label="macOS"
              platform="Apple Silicon / Intel"
              status="planned"
              description="macOS 构建尚未发布。准备好后会在这里提供对应安装包。"
            />
            <PlatformCard
              label="Linux"
              platform="x64 / arm64"
              status="planned"
              description="Linux 构建尚未发布。当前页面不会提供不可用的下载地址。"
            />
          </div>
        </div>
      </section>

      <section className="bg-paper py-20 md:py-28">
        <div className="mx-auto max-w-[1440px] px-5 md:px-10">
          <div className="grid gap-10 lg:grid-cols-[0.7fr_1.3fr]">
            <div>
              <p className="font-mono text-[0.68rem] uppercase tracking-[0.16em] text-graphite">
                04 / 边界说明
              </p>
              <h2 className="mt-5 text-4xl font-semibold leading-[0.95] tracking-[-0.06em] sm:text-5xl">
                下载前，
                <br />
                先知道边界。
              </h2>
            </div>
            <Accordion className="border-t border-carbon/15" defaultValue={["local"]}>
              <AccordionItem value="local">
                <AccordionTrigger className="py-6 text-left text-lg text-carbon hover:no-underline">
                  数据默认留在本机
                </AccordionTrigger>
                <AccordionContent className="pb-6 text-sm leading-7 text-graphite">
                  Ayaka 的文件、SQLite 数据和运行记录默认留在本机；Provider、MCP 和 Skill secrets
                  在主进程边界内解析。
                </AccordionContent>
              </AccordionItem>
              <AccordionItem value="trace">
                <AccordionTrigger className="py-6 text-left text-lg text-carbon hover:no-underline">
                  每次运行都有记录
                </AccordionTrigger>
                <AccordionContent className="pb-6 text-sm leading-7 text-graphite">
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

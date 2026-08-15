import { useEffect, useState, type ReactNode } from "react";

interface LatestRelease {
  downloadUrl: string;
}

const capabilities = [
  {
    index: "01",
    code: "Chat",
    title: "对话是入口",
    description: "从一句自然语言开始，把问题交给一个真正能继续行动的工作台。",
  },
  {
    index: "02",
    code: "Agents",
    title: "智能体会协作",
    description: "让 Agents 负责身份、模型策略、工具选择与交接，复杂任务也能保持清晰。",
  },
  {
    index: "03",
    code: "Memory",
    title: "记忆留在上下文",
    description: "事实、偏好、经历和技能被整理成可追踪的本地记忆，而不是一团黑箱。",
  },
  {
    index: "04",
    code: "Tools",
    title: "工具接入行动",
    description: "Skills、MCP 和本地工具被放进同一条运行链路，按需启用，也随时可审阅。",
  },
];

const operationSteps = [
  {
    number: "01",
    label: "Input",
    title: "说出任务",
    detail: "从一句话开始，Ayaka 先确认你要完成什么。",
  },
  {
    number: "02",
    label: "Agent loop",
    title: "智能体行动",
    detail: "运行被拆成连续步骤，每一步都有来源和状态。",
  },
  {
    number: "03",
    label: "Skill + tool",
    title: "调用能力",
    detail: "需要工具时再接入，敏感操作保留清晰的审核边界。",
  },
  {
    number: "04",
    label: "Memory",
    title: "留下线索",
    detail: "有价值的事实与偏好进入本地记忆，下一次继续接上。",
  },
  {
    number: "05",
    label: "Result",
    title: "回到结果",
    detail: "每次运行都有可读摘要，也可以追溯过程与诊断信息。",
  },
];

function ArrowMark() {
  return (
    <span aria-hidden="true" className="arrow-mark">
      &gt;
    </span>
  );
}

function DownloadButton({
  downloadUrl,
  children,
}: {
  downloadUrl: string | null;
  children: ReactNode;
}) {
  if (!downloadUrl) {
    return (
      <button className="site-button site-button-primary" type="button" disabled>
        暂无可用下载 <ArrowMark />
      </button>
    );
  }

  return (
    <a
      className="site-button site-button-primary"
      href={downloadUrl}
      target="_blank"
      rel="noreferrer"
    >
      {children} <ArrowMark />
    </a>
  );
}

function SiteHeader() {
  return (
    <header className="site-header">
      <a className="brand-lockup" href="#top" aria-label="Ayaka 首页">
        <span className="brand-seal" aria-hidden="true">
          A
        </span>
        <span>
          <strong>Ayaka</strong>
          <small>LOCAL WORKSPACE</small>
        </span>
      </a>
      <nav className="site-nav" aria-label="主导航">
        <a href="#capabilities">能力档案</a>
        <a href="#operation">运行方式</a>
        <a href="#privacy">本地边界</a>
      </nav>
    </header>
  );
}

function ProductPreview() {
  return (
    <div className="product-preview" aria-label="Ayaka 工作台预览">
      <div className="preview-sky-shape preview-sun" aria-hidden="true" />
      <div className="preview-sky-shape preview-cloud preview-cloud-one" aria-hidden="true" />
      <div className="preview-sky-shape preview-cloud preview-cloud-two" aria-hidden="true" />
      <div className="preview-window">
        <div className="preview-window-bar">
          <span className="window-dots" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <span>Operation / void-001</span>
          <span className="window-online">Local online</span>
        </div>
        <div className="preview-window-body">
          <aside className="preview-sidebar" aria-label="工作台导航预览">
            <div className="preview-wordmark">Ayaka</div>
            <div className="preview-nav-item preview-nav-active">
              <span>⌁</span> Chat
            </div>
            <div className="preview-nav-item">
              <span>◇</span> Agents
            </div>
            <div className="preview-nav-item">
              <span>○</span> Memory
            </div>
            <div className="preview-nav-item">
              <span>⊙</span> Server
            </div>
            <div className="preview-sidebar-foot">BUILD 0.0.1</div>
          </aside>
          <div className="preview-content">
            <div className="preview-content-header">
              <div>
                <span className="preview-label">Agent run / active</span>
                <h3>把今天的任务交给我</h3>
              </div>
              <span className="preview-status">Sync ready</span>
            </div>
            <div className="preview-message preview-message-user">
              <span className="preview-avatar avatar-user">你</span>
              <p>整理这周的项目线索，并记住我的工作偏好。</p>
            </div>
            <div className="preview-message preview-message-agent">
              <span className="preview-avatar avatar-agent">A</span>
              <div>
                <p>收到。我会先检索本地记录，再把结果整理成一份可继续执行的摘要。</p>
                <div className="preview-tool-row">
                  <span>Memory search</span>
                  <span>Tool ready</span>
                </div>
              </div>
            </div>
            <div className="preview-run-card">
              <div className="run-card-heading">
                <span>Run trace</span>
                <strong>03 / 05</strong>
              </div>
              <div className="run-progress">
                <span />
              </div>
              <div className="run-card-footer">
                <span>Agent loop is moving</span>
                <span>12.4s</span>
              </div>
            </div>
            <div className="preview-input">
              <span>继续给 Ayaka 一个任务...</span>
              <span className="input-arrow">&gt;</span>
            </div>
          </div>
        </div>
      </div>
      <div className="preview-stamp">
        Field note
        <br />
        <strong>Local first</strong>
      </div>
    </div>
  );
}

function Hero({ downloadUrl }: { downloadUrl: string | null }) {
  return (
    <section className="hero-section" id="top">
      <div className="hero-copy">
        <div className="mission-label">
          <span className="mission-dot" /> Local-first workspace
        </div>
        <h1>
          让你的 AI，
          <br />
          <em>在本地醒来。</em>
        </h1>
        <p className="hero-lede">
          Ayaka 是一个本地优先的 AI
          桌面工作台。把对话、智能体、记忆和工具放在同一条可追踪的运行链路里。
        </p>
        <div className="hero-actions">
          <DownloadButton downloadUrl={downloadUrl}>下载 Ayaka</DownloadButton>
          <a className="site-button site-button-quiet" href="#capabilities">
            查看能力档案 <span aria-hidden="true">↓</span>
          </a>
        </div>
        <div className="hero-footnote">
          <span>Desktop workspace</span>
          <span>MIT license</span>
          <span>EN / ZH ready</span>
        </div>
      </div>
      <ProductPreview />
    </section>
  );
}

function SectionHeading({
  code,
  title,
  description,
}: {
  code: string;
  title: string;
  description: string;
}) {
  return (
    <div className="section-heading">
      <span className="section-code">{code}</span>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}

function CapabilitiesSection() {
  return (
    <section className="content-section capabilities-section" id="capabilities">
      <SectionHeading
        code="02 / CAPABILITY ARCHIVE"
        title="一座工作台，四种行动方式。"
        description="从对话开始，向外连接智能体、记忆和工具。每个入口都服务于同一件事：让任务继续向前。"
      />
      <div className="capability-grid">
        {capabilities.map((capability) => (
          <article className="capability-card" key={capability.index}>
            <div className="card-topline">
              <span>{capability.index}</span>
              <span>{capability.code}</span>
            </div>
            <h3>{capability.title}</h3>
            <p>{capability.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

function OperationSection() {
  return (
    <section className="content-section operation-section" id="operation">
      <SectionHeading
        code="03 / OPERATION TRACE"
        title="从一句话，到一条完整的运行记录。"
        description="Ayaka 不把过程藏在幕后。每个 Agent Loop 都有自己的轨迹，方便你知道发生了什么，也知道下一步是什么。"
      />
      <div className="operation-board">
        {operationSteps.map((step, index) => (
          <div className="operation-step" key={step.number}>
            <div className="operation-step-marker">
              <span>{step.number}</span>
              {index < operationSteps.length - 1 && <i aria-hidden="true" />}
            </div>
            <div className="operation-step-copy">
              <span className="operation-label">{step.label}</span>
              <h3>{step.title}</h3>
              <p>{step.detail}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="operation-note">
        <span className="note-sigil" aria-hidden="true">
          !
        </span>
        <p>
          <strong>运行记录不会消失。</strong>{" "}
          任务来源、工具调用、交接和错误都会被写入本地运行表，方便复盘，也方便你重新接管。
        </p>
      </div>
    </section>
  );
}

function PrivacySection() {
  return (
    <section className="content-section privacy-section" id="privacy">
      <div className="privacy-panel">
        <div className="privacy-copy">
          <span className="section-code">04 / BOUNDARY PROTOCOL</span>
          <h2>
            你的工作空间，
            <br />
            <em>不需要先离开你的设备。</em>
          </h2>
          <p>
            Ayaka 的默认姿态是 local-first。桌面端负责文件、数据库、密钥、MCP
            连接和运行记录；渲染层只通过明确的桥接访问它们。
          </p>
        </div>
        <div className="privacy-list">
          <div className="privacy-row">
            <span>01</span>
            <div>
              <strong>数据默认留在本机</strong>
              <p>SQLite 和本地文件记录工作上下文，不要求先搭一套云端服务。</p>
            </div>
            <span className="privacy-status">Local</span>
          </div>
          <div className="privacy-row">
            <span>02</span>
            <div>
              <strong>密钥留在主进程</strong>
              <p>Provider、MCP 和 Skill secrets 在受保护的运行边界内解析。</p>
            </div>
            <span className="privacy-status">Sealed</span>
          </div>
          <div className="privacy-row">
            <span>03</span>
            <div>
              <strong>每次行动都有记录</strong>
              <p>运行状态、工具调用、审批与诊断都保留在可追踪的本地表里。</p>
            </div>
            <span className="privacy-status">Traceable</span>
          </div>
        </div>
      </div>
    </section>
  );
}

function DownloadSection({ downloadUrl }: { downloadUrl: string | null }) {
  return (
    <section className="download-section" id="download">
      <div className="download-panel">
        <div>
          <span className="section-code">06 / BEGIN THE OPERATION</span>
          <h2>准备好，让本地智能体开始行动。</h2>
          <p>Ayaka 仍在持续生长。下载最新构建，开始你的本地运行。</p>
        </div>
        <div className="download-actions">
          <DownloadButton downloadUrl={downloadUrl}>下载最新版本</DownloadButton>
        </div>
      </div>
    </section>
  );
}

function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="footer-brand">
        <span className="brand-seal" aria-hidden="true">
          A
        </span>
        <div>
          <strong>Ayaka</strong>
          <span>本地优先的 AI 桌面工作台</span>
        </div>
      </div>
      <div className="footer-meta">
        <span>LOCAL BY DEFAULT</span>
        <span>MIT LICENSE</span>
        <span>(C) 2026 ZZZVoid</span>
      </div>
    </footer>
  );
}

export function SiteHome() {
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/releases/latest?platform=win32&arch=x64")
      .then((response) => {
        if (!response.ok) throw new Error("Latest release unavailable.");
        return response.json() as Promise<LatestRelease>;
      })
      .then((release) => {
        if (!cancelled && typeof release.downloadUrl === "string") {
          setDownloadUrl(release.downloadUrl);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="site-page">
      <SiteHeader />
      <Hero downloadUrl={downloadUrl} />
      <CapabilitiesSection />
      <OperationSection />
      <PrivacySection />
      <DownloadSection downloadUrl={downloadUrl} />
      <SiteFooter />
    </main>
  );
}

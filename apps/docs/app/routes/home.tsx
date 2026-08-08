import { SiteHome } from "../components/site-home";

export function meta() {
  return [
    { title: "Void AI｜本地优先的 AI 桌面工作台" },
    {
      name: "description",
      content:
        "Void AI 是一个本地优先的 AI 桌面工作台，把对话、智能体、记忆和工具放在同一条可追踪的运行链路里。",
    },
  ];
}

export default function Home() {
  return <SiteHome />;
}

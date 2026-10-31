import { useLoaderData } from "react-router";

import type { Route } from "./+types/home";
import { SiteHome } from "../components/site-home";
import { fetchLatestReleaseForRequest } from "../lib/release-client";

export async function loader({ request }: Route.LoaderArgs) {
  return fetchLatestReleaseForRequest(request);
}

export function meta() {
  return [
    { title: "Ayaka · 住在你电脑里的数字生命体" },
    {
      name: "description",
      content:
        "Ayaka 是一个本地优先的 AI 桌面陪伴：她的记忆、你的对话、每一次行动，都留在这台电脑上。私人、主动、能延续关系。",
    },
  ];
}

export default function Home() {
  const releaseData = useLoaderData<typeof loader>();
  return <SiteHome releaseData={releaseData} />;
}

import { useLoaderData } from "react-router";

import type { Route } from "./+types/download";
import { SiteDownload } from "../components/site-download";
import { fetchLatestReleaseForRequest } from "../lib/release-client";

export async function loader({ request }: Route.LoaderArgs) {
  return fetchLatestReleaseForRequest(request);
}

export function meta() {
  return [
    { title: "下载 Ayaka｜Windows x64" },
    {
      name: "description",
      content: "下载 Ayaka Windows x64 版本，了解当前发布状态、本地数据边界和未来平台计划。",
    },
  ];
}

export default function Download() {
  const releaseData = useLoaderData<typeof loader>();
  return <SiteDownload releaseData={releaseData} />;
}

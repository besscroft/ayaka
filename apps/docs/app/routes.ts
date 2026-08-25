import { route, type RouteConfig, index } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),
  route("download", "routes/download.tsx"),
] satisfies RouteConfig;

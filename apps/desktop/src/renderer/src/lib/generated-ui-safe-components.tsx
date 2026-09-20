import { shadcnComponents } from "@json-render/shadcn";
import { Button as AyakaButton } from "../components/ui/button";
import {
  Card as AyakaCard,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../components/ui/card";
import { cn } from "./utils";
import { sanitizeRichContentUrl } from "../components/ai-elements/rich-content-utils";

type ImageRenderProps = Parameters<typeof shadcnComponents.Image>[0];
type AvatarRenderProps = Parameters<typeof shadcnComponents.Avatar>[0];
type LinkRenderProps = Parameters<typeof shadcnComponents.Link>[0];
type CardRenderProps = Parameters<typeof shadcnComponents.Card>[0];
type ButtonRenderProps = Parameters<typeof shadcnComponents.Button>[0];

export function GeneratedCard({ props, children }: CardRenderProps): React.JSX.Element {
  const maxWidth = {
    sm: "max-w-sm",
    md: "max-w-md",
    lg: "max-w-lg",
    full: "max-w-full",
  }[props.maxWidth ?? "full"];
  return (
    <AyakaCard className={cn(maxWidth, props.centered && "mx-auto", props.className)}>
      {props.title || props.description ? (
        <CardHeader>
          {props.title ? <CardTitle>{props.title}</CardTitle> : null}
          {props.description ? <CardDescription>{props.description}</CardDescription> : null}
        </CardHeader>
      ) : null}
      <CardContent>{children}</CardContent>
    </AyakaCard>
  );
}

export function GeneratedButton({ props, emit }: ButtonRenderProps): React.JSX.Element {
  const variant =
    props.variant === "danger" ? "danger" : props.variant === "primary" ? "primary" : "secondary";
  return (
    <AyakaButton
      variant={variant}
      isDisabled={props.disabled ?? false}
      onPress={() => emit("press")}
    >
      {props.label}
    </AyakaButton>
  );
}

export function SafeImage({ props, ...rest }: ImageRenderProps): React.JSX.Element {
  const src = props.src ? sanitizeRichContentUrl(props.src, "image") : null;
  return shadcnComponents.Image({ ...rest, props: { ...props, src } });
}

export function SafeAvatar({ props, ...rest }: AvatarRenderProps): React.JSX.Element {
  const src = props.src ? sanitizeRichContentUrl(props.src, "image") : null;
  return shadcnComponents.Avatar({ ...rest, props: { ...props, src } });
}

export function SafeLink({ props, ...rest }: LinkRenderProps): React.JSX.Element {
  const href = sanitizeRichContentUrl(props.href, "link");
  if (!href) {
    return <span className="text-muted-foreground">{props.label}</span>;
  }
  return shadcnComponents.Link({ ...rest, props: { ...props, href } });
}

import { defineRegistry, type ComponentRegistry } from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";
import { generatedUICatalog } from "@shared/generated-ui/catalog";
import {
  GeneratedButton,
  GeneratedCard,
  SafeAvatar,
  SafeImage,
  SafeLink,
} from "./generated-ui-safe-components";

const registryComponents = {
  ...shadcnComponents,
  Card: GeneratedCard,
  Button: GeneratedButton,
  Image: SafeImage,
  Avatar: SafeAvatar,
  Link: SafeLink,
};

const generatedUIRegistryResult = defineRegistry(generatedUICatalog, {
  components: registryComponents,
});

export const generatedUIRegistry: ComponentRegistry = generatedUIRegistryResult.registry;

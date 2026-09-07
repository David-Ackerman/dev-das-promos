import type { PublicationChannel } from "@dev-das-promos/shared";
import type { Publisher } from "../types.js";
import { type TelegramCredentials, createTelegramPublisher } from "./telegram-publisher.js";
import { WebPublisher } from "./web-publisher.js";
import { type XCredentials, createXPublisher } from "./x-publisher.js";

export interface PublisherRegistryOptions {
  telegram?: Partial<TelegramCredentials>;
  x?: Partial<XCredentials>;
}

export function createPublisherRegistry(
  options: PublisherRegistryOptions = {},
): Record<PublicationChannel, Publisher> {
  return {
    telegram: createTelegramPublisher(options.telegram),
    x: createXPublisher(options.x),
    web: new WebPublisher(),
  };
}

export function getPublisher(
  channel: PublicationChannel,
  options: PublisherRegistryOptions = {},
): Publisher {
  const registry = createPublisherRegistry(options);
  const publisher = registry[channel];
  if (!publisher) {
    throw new Error(`No publisher registered for channel "${channel}"`);
  }
  return publisher;
}

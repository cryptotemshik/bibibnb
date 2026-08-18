import { http, createConfig } from "wagmi";
import { injected } from "wagmi/connectors";
import { robinhoodChain } from "./config";

export const wagmiConfig = createConfig({
  chains: [robinhoodChain],
  connectors: [injected()],
  transports: {
    [robinhoodChain.id]: http(),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}

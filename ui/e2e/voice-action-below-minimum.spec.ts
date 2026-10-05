import {
  expect,
  test as hostTest,
} from "@/e2e/fixtures/test-base";
import { withVoiceMobilePage } from "./host-mobile-fixture";
import { registerRejectedMinimumInstallTest } from "./voice-install-floor";

registerRejectedMinimumInstallTest(
  withVoiceMobilePage(hostTest, false),
  expect,
  "v0.87.0",
);

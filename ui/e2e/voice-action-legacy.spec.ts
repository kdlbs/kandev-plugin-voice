import {
  expect,
  test as hostTest,
} from "../../../kandev-fallback-088/apps/web/e2e/fixtures/test-base";
import { withVoiceMobilePage } from "./host-mobile-fixture";
import { registerVoiceActionTests } from "./voice-action-suite";

const test = withVoiceMobilePage(hostTest, false);
registerVoiceActionTests(test, expect);

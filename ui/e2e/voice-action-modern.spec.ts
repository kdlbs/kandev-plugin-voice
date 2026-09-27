import {
  expect,
  test as hostTest,
} from "../../../kandev/apps/web/e2e/fixtures/test-base";
import { withVoiceMobilePage } from "./host-mobile-fixture";
import { registerVoiceActionTests } from "./voice-action-suite";

const test = withVoiceMobilePage(hostTest, true);
registerVoiceActionTests(test, expect);

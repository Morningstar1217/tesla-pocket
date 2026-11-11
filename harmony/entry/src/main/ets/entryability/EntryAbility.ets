import { UIAbility, ConfigurationConstant } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';

export default class EntryAbility extends UIAbility {
  onCreate(): void {
    try { this.context.getApplicationContext().setColorMode(ConfigurationConstant.ColorMode.COLOR_MODE_DARK); }
    catch { console.warn('[cheji] color mode unavailable'); }
    AppStorage.setOrCreate('cheji.foreground', true);
  }

  async onWindowStageCreate(stage: window.WindowStage): Promise<void> {
    const win = stage.getMainWindowSync();
    try {
      await win.setWindowLayoutFullScreen(false);
      await win.setWindowSystemBarProperties({
        statusBarColor: '#171819', statusBarContentColor: '#F4F4F4',
        navigationBarColor: '#171819', navigationBarContentColor: '#F4F4F4'
      });
    } catch { console.warn('[cheji] system bar configuration unavailable'); }
    await stage.loadContent('pages/Index');
    try { win.setWindowBackgroundColor('#171819'); }
    catch { console.warn('[cheji] window background unavailable'); }
  }

  onForeground(): void { AppStorage.setOrCreate('cheji.foreground', true); }
  onBackground(): void { AppStorage.setOrCreate('cheji.foreground', false); }
}

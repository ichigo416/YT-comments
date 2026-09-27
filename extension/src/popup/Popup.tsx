import { useEffect, useState } from "react";
import { DEFAULT_SETTINGS, loadSettings, saveSettings } from "../shared/settings";
import type { DisplayMode, Settings } from "../shared/types";

export function Popup() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void loadSettings().then((stored) => {
      setSettings(stored);
      setLoaded(true);
    });
  }, []);

  function update(patch: Partial<Settings>): void {
    const next = { ...settings, ...patch };
    setSettings(next);
    void saveSettings(next);
  }

  if (!loaded) return null;

  return (
    <main>
      <h1>Comment scorer</h1>

      <label className="row">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
        />
        <span>Score comments on YouTube</span>
      </label>

      <fieldset disabled={!settings.enabled}>
        <legend>Flagged comments</legend>
        {(["badge", "blur"] as const satisfies readonly DisplayMode[]).map((mode) => (
          <label className="row" key={mode}>
            <input
              type="radio"
              name="mode"
              checked={settings.mode === mode}
              onChange={() => update({ mode })}
            />
            <span>{mode === "badge" ? "Show a badge only" : "Blur until I click"}</span>
          </label>
        ))}

        <label className="slider">
          <span>Flag at {Math.round(settings.threshold * 100)}% toxicity or higher</span>
          <input
            type="range"
            min={30}
            max={95}
            step={5}
            value={Math.round(settings.threshold * 100)}
            onChange={(e) => update({ threshold: Number(e.target.value) / 100 })}
          />
        </label>
      </fieldset>

      <p className="note">Comment text is sent to your scoring server. It is not stored by this extension.</p>
    </main>
  );
}

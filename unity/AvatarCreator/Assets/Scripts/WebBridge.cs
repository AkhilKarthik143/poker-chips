using System;
using System.IO;
using System.Runtime.InteropServices;
using UnityEngine;

public sealed class WebBridge : MonoBehaviour
{
    public static WebBridge Instance { get; private set; }
    public event Action<bool, string> Saved;

#if UNITY_WEBGL && !UNITY_EDITOR
    [DllImport("__Internal")] private static extern string TM_GetInitialSpec();
    [DllImport("__Internal")] private static extern void TM_SaveSpec(string json);
    [DllImport("__Internal")] private static extern bool TM_GetPrefersReducedMotion();
    [DllImport("__Internal")] private static extern void TM_Navigate(string path);
#endif

    private void Awake()
    {
        name = "AvatarBridge";
        Instance = this;
    }

    public string GetInitialSpec()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        return TM_GetInitialSpec();
#else
        string path = Path.Combine(Application.persistentDataPath, "avatar.json");
        return File.Exists(path) ? File.ReadAllText(path) : "";
#endif
    }

    public bool GetPrefersReducedMotion()
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        return TM_GetPrefersReducedMotion();
#else
        return false;
#endif
    }

    public void SaveSpec(string json)
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        TM_SaveSpec(json);
#else
        File.WriteAllText(Path.Combine(Application.persistentDataPath, "avatar.json"), json);
        OnSaveResult("ok");
#endif
    }

    public void Navigate(string path)
    {
        if (string.IsNullOrEmpty(path) || !path.StartsWith("/") || path.StartsWith("//")) path = "/me.html";
#if UNITY_WEBGL && !UNITY_EDITOR
        TM_Navigate(path);
#else
        Debug.Log("Navigate to " + path);
#endif
    }

    public void OnSaveResult(string message)
    {
        bool ok = message == "ok";
        Saved?.Invoke(ok, ok ? "Character saved." : message.StartsWith("error:") ? message.Substring(6) : "Could not save character.");
    }
}


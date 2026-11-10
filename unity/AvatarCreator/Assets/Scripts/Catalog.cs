using System;
using System.Collections;
using UnityEngine;
using UnityEngine.Networking;

[Serializable]
public sealed class AvatarManifestHeader
{
    public int version;
    public int size;
}

public sealed class Catalog : MonoBehaviour
{
    public bool Ready { get; private set; }
    public string Error { get; private set; }

    public IEnumerator Load(Action onReady)
    {
        string path = Application.streamingAssetsPath + "/manifest.json";
#if UNITY_EDITOR
        path = "file://" + path;
#endif
        using (UnityWebRequest request = UnityWebRequest.Get(path))
        {
            yield return request.SendWebRequest();
            if (request.result != UnityWebRequest.Result.Success)
            {
                Error = "Character catalog could not load.";
                yield break;
            }
            AvatarManifestHeader header = JsonUtility.FromJson<AvatarManifestHeader>(request.downloadHandler.text);
            if (header == null || header.version != AvatarParts.ManifestVersion || header.size != AvatarParts.Size)
            {
                Error = "Character catalog version does not match this build.";
                yield break;
            }
        }
        Ready = true;
        onReady?.Invoke();
    }

    public Sprite Sprite(string slot, string id)
    {
        return Resources.Load<Sprite>("AvatarLayers/" + slot + "/" + id);
    }

    public static Color ColorFor(string id, bool skin)
    {
        string[] ids = skin ? AvatarParts.SkinIds : AvatarParts.PaletteIds;
        string[] hexes = skin ? AvatarParts.SkinHex : AvatarParts.PaletteHex;
        int index = Array.IndexOf(ids, id);
        if (index < 0) return Color.white;
        ColorUtility.TryParseHtmlString(hexes[index], out Color color);
        return color;
    }
}

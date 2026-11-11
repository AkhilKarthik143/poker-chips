using System.Collections;
using UnityEngine;

public sealed class Bootstrap : MonoBehaviour
{
    private Catalog catalog;
    private LayerCompositor compositor;
    private CreatorUI creator;
    private AvatarSpec spec;

    [RuntimeInitializeOnLoadMethod(RuntimeInitializeLoadType.AfterSceneLoad)]
    private static void StartCreator()
    {
        new GameObject("AvatarCreator").AddComponent<Bootstrap>();
    }

    private void Start()
    {
        GameObject cameraNode = new GameObject("Main Camera", typeof(Camera));
        cameraNode.tag = "MainCamera";
        cameraNode.transform.position = new Vector3(0, 0, -10);
        Camera camera = cameraNode.GetComponent<Camera>();
        camera.orthographic = true; camera.orthographicSize = 1.4f;
        camera.clearFlags = CameraClearFlags.SolidColor;
        camera.backgroundColor = new Color32(255, 253, 245, 255);

        WebBridge bridge = new GameObject("AvatarBridge").AddComponent<WebBridge>();
        spec = AvatarSpec.FromJson(bridge.GetInitialSpec());
        catalog = gameObject.AddComponent<Catalog>();
        GameObject portrait = new GameObject("Character");
        compositor = portrait.AddComponent<LayerCompositor>();
        compositor.Initialize(catalog);
        IdleAnimator idle = portrait.AddComponent<IdleAnimator>();
        idle.Compositor = compositor; idle.ReducedMotion = bridge.GetPrefersReducedMotion();
        creator = gameObject.AddComponent<CreatorUI>();
        creator.Initialize(spec, compositor, bridge);
        StartCoroutine(LoadArt());
    }

    private IEnumerator LoadArt()
    {
        yield return StartCoroutine(catalog.Load(null));
        if (!catalog.Ready) { creator.SetStatus(catalog.Error + " Use the simple builder."); yield break; }
        creator.Refresh();
        creator.SetStatus("Choose a look, then save.");
    }
}

using System;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.UI;

public sealed class CreatorUI : MonoBehaviour
{
    private AvatarSpec spec;
    private AvatarSpec original;
    private LayerCompositor compositor;
    private WebBridge bridge;
    private RectTransform footer;
    private RectTransform optionsContent;
    private Text status;
    private Button save;
    private string tab = "hair";
    private bool landscape;
    private Font font;
    private static readonly Color Ink = new Color32(35, 47, 65, 255);
    private static readonly Color Paper = new Color32(255, 253, 245, 255);
    private static readonly Color Mint = new Color32(196, 242, 158, 255);

    public void Initialize(AvatarSpec initial, LayerCompositor layers, WebBridge pageBridge)
    {
        original = AvatarSpec.FromJson(initial.ToJson()); spec = AvatarSpec.FromJson(initial.ToJson());
        compositor = layers; bridge = pageBridge; font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
        bridge.Saved += OnSaved;
        if (FindFirstObjectByType<EventSystem>() == null)
            new GameObject("EventSystem", typeof(EventSystem), typeof(StandaloneInputModule));
        Build();
        if (compositor.Ready) Refresh(); else SetStatus("Loading character…");
    }

    private void OnDestroy() { if (bridge != null) bridge.Saved -= OnSaved; }

    public void SetStatus(string message) { if (status != null) status.text = message; }

    private RectTransform Panel(string name, Transform parent, Color color)
    {
        GameObject node = new GameObject(name, typeof(RectTransform), typeof(Image));
        node.transform.SetParent(parent, false);
        node.GetComponent<Image>().color = color;
        return node.GetComponent<RectTransform>();
    }

    private static void Place(RectTransform rect, Vector2 min, Vector2 max, Vector2 offsetMin, Vector2 offsetMax)
    {
        rect.anchorMin = min; rect.anchorMax = max; rect.offsetMin = offsetMin; rect.offsetMax = offsetMax;
    }

    private Text Label(string name, Transform parent, string value, int size, TextAnchor align)
    {
        GameObject node = new GameObject(name, typeof(RectTransform), typeof(Text));
        node.transform.SetParent(parent, false);
        Text text = node.GetComponent<Text>(); text.font = font; text.fontSize = size; text.color = Ink;
        text.alignment = align; text.text = value; return text;
    }

    private Button Action(string name, Transform parent, string value, Action handler, Color color)
    {
        RectTransform rect = Panel(name, parent, color);
        Button button = rect.gameObject.AddComponent<Button>();
        button.onClick.AddListener(() => handler());
        Text label = Label("Label", rect, value, 15, TextAnchor.MiddleCenter);
        Place(label.rectTransform, Vector2.zero, Vector2.one, Vector2.zero, Vector2.zero);
        return button;
    }

    private RectTransform Scroll(string name, Transform parent, bool horizontal)
    {
        RectTransform viewport = Panel(name, parent, Paper);
        viewport.gameObject.AddComponent<Mask>().showMaskGraphic = false;
        ScrollRect scroll = viewport.gameObject.AddComponent<ScrollRect>();
        scroll.horizontal = horizontal; scroll.vertical = !horizontal;
        RectTransform content = new GameObject("Content", typeof(RectTransform)).GetComponent<RectTransform>();
        content.SetParent(viewport, false);
        content.anchorMin = horizontal ? new Vector2(0, 0) : new Vector2(0, 1);
        content.anchorMax = horizontal ? new Vector2(0, 1) : new Vector2(1, 1);
        content.pivot = horizontal ? new Vector2(0, 0.5f) : new Vector2(0.5f, 1);
        scroll.viewport = viewport; scroll.content = content;
        return viewport;
    }

    private void Build()
    {
        GameObject canvasNode = new GameObject("AvatarCreatorCanvas", typeof(RectTransform), typeof(Canvas),
            typeof(CanvasScaler), typeof(GraphicRaycaster));
        canvasNode.transform.SetParent(transform, false);
        Canvas canvas = canvasNode.GetComponent<Canvas>(); canvas.renderMode = RenderMode.ScreenSpaceOverlay;
        CanvasScaler scaler = canvasNode.GetComponent<CanvasScaler>();
        scaler.uiScaleMode = CanvasScaler.ScaleMode.ScaleWithScreenSize;
        scaler.referenceResolution = new Vector2(360, 640); scaler.matchWidthOrHeight = 0.5f;
        RectTransform header = Panel("Header", canvasNode.transform, Paper);
        Place(header, new Vector2(0, 1), Vector2.one, new Vector2(0, -76), Vector2.zero);
        Text title = Label("Title", header, "MAKE YOUR TABLEMATE", 19, TextAnchor.MiddleLeft);
        Place(title.rectTransform, Vector2.zero, Vector2.one, new Vector2(18, 24), new Vector2(-18, 0));
        status = Label("Status", header, "Choose a look, then save.", 12, TextAnchor.MiddleLeft);
        Place(status.rectTransform, Vector2.zero, Vector2.one, new Vector2(18, 0), new Vector2(-18, -48));

        footer = Panel("Controls", canvasNode.transform, Paper);
        RectTransform tabs = Scroll("Tabs", footer, true);
        Place(tabs, new Vector2(0, 1), Vector2.one, new Vector2(12, -60), new Vector2(-12, -8));
        RectTransform tabContent = tabs.GetComponent<ScrollRect>().content;
        string[] names = { "skin", "hair", "eyes", "mouth", "facialHair", "hat", "glasses", "outfit", "bg", "frame" };
        for (int index = 0; index < names.Length; index++)
        {
            string choice = names[index];
            Button button = Action("Tab_" + choice, tabContent, choice, () => { tab = choice; BuildOptions(); }, Mint);
            RectTransform rect = button.GetComponent<RectTransform>();
            Place(rect, new Vector2(0, 0), new Vector2(0, 1), new Vector2(index * 84, 0), new Vector2(index * 84 + 78, 0));
        }
        tabContent.sizeDelta = new Vector2(names.Length * 84, 0);
        RectTransform options = Scroll("Options", footer, false);
        Place(options, Vector2.zero, Vector2.one, new Vector2(12, 62), new Vector2(-12, -66));
        optionsContent = options.GetComponent<ScrollRect>().content;

        RectTransform actions = Panel("Actions", footer, Paper);
        Place(actions, Vector2.zero, new Vector2(1, 0), new Vector2(12, 6), new Vector2(-12, 56));
        string[] labels = { "Shuffle", "Reset", "Save", "Back" };
        Action[] handlers = { Randomize, Reset, Save, () => bridge.Navigate("/me.html") };
        for (int index = 0; index < labels.Length; index++)
        {
            int number = index;
            Button button = Action(labels[index], actions, labels[index], handlers[index], index == 2 ? Mint : Paper);
            Place(button.GetComponent<RectTransform>(), new Vector2(number * .25f, 0),
                new Vector2((number + 1) * .25f, 1), new Vector2(2, 0), new Vector2(-2, 0));
            if (index == 2) save = button;
        }
        Resize(); BuildOptions();
    }

    private void Update() { if (landscape != (Screen.width > Screen.height)) Resize(); }

    private void Resize()
    {
        landscape = Screen.width > Screen.height;
        if (landscape)
        {
            Place(footer, new Vector2(.47f, 0), Vector2.one, Vector2.zero, new Vector2(0, -76));
            compositor.transform.position = new Vector3(-.7f, 0, 0);
            Camera.main.orthographicSize = 1f;
        }
        else
        {
            Place(footer, Vector2.zero, new Vector2(1, 0), Vector2.zero, new Vector2(0, 270));
            compositor.transform.position = new Vector3(0, .3f, 0);
            Camera.main.orthographicSize = 1.4f;
        }
    }

    private string[] Options()
    {
        switch (tab)
        {
            case "skin": return AvatarParts.SkinIds;
            case "hair": return AvatarParts.HairFront;
            case "eyes": return AvatarParts.Eyes;
            case "mouth": return AvatarParts.Mouth;
            case "facialHair": return AvatarParts.FacialHair;
            case "hat": return AvatarParts.Hat;
            case "glasses": return AvatarParts.Glasses;
            case "outfit": return AvatarParts.Outfit;
            case "bg": return AvatarParts.PaletteIds;
            default: return AvatarParts.Frame;
        }
    }

    private void BuildOptions()
    {
        foreach (Transform child in optionsContent) Destroy(child.gameObject);
        string[] values = Options();
        int rows = Mathf.CeilToInt(values.Length / 4f);
        int top = 0;
        for (int index = 0; index < values.Length; index++)
        {
            string value = values[index]; int col = index % 4; int row = index / 4;
            Color color = tab == "skin" ? Catalog.ColorFor(value, true) : tab == "bg" ? Catalog.ColorFor(value, false) : Mint;
            Button button = Action("Option_" + value, optionsContent, value, () => Choose(value), color);
            Place(button.GetComponent<RectTransform>(), new Vector2(col * .25f, 1),
                new Vector2((col + 1) * .25f, 1), new Vector2(2, -row * 52 - 50), new Vector2(-2, -row * 52 - 2));
        }
        top += rows * 52;
        string colorField = tab == "hair" ? "hairColor" : tab == "facialHair" ? "facialHairColor"
            : tab == "outfit" ? "outfitColor" : "";
        if (colorField != "")
        {
            Text label = Label("ColorLabel", optionsContent, "COLOR", 13, TextAnchor.MiddleLeft);
            Place(label.rectTransform, new Vector2(0, 1), Vector2.one, new Vector2(3, -top - 26), new Vector2(-3, -top));
            top += 28;
            for (int index = 0; index < AvatarParts.PaletteIds.Length; index++)
            {
                string value = AvatarParts.PaletteIds[index]; int col = index % 4; int row = index / 4;
                Button button = Action("Color_" + value, optionsContent, value,
                    () => { SetColor(colorField, value); Refresh(); }, Catalog.ColorFor(value, false));
                Place(button.GetComponent<RectTransform>(), new Vector2(col * .25f, 1),
                    new Vector2((col + 1) * .25f, 1), new Vector2(2, -top - row * 52 - 50), new Vector2(-2, -top - row * 52 - 2));
            }
            top += 3 * 52;
        }
        optionsContent.sizeDelta = new Vector2(0, top);
    }

    private void Choose(string value)
    {
        switch (tab)
        {
            case "skin": spec.skin = value; break;
            case "hair": spec.hair = value; break;
            case "eyes": spec.eyes = value; break;
            case "mouth": spec.mouth = value; break;
            case "facialHair": spec.facialHair = value; break;
            case "hat": spec.hat = value; break;
            case "glasses": spec.glasses = value; break;
            case "outfit": spec.outfit = value; break;
            case "bg": spec.bg = value; break;
            case "frame": spec.frame = value; break;
        }
        Refresh();
    }

    private void SetColor(string field, string value)
    {
        if (field == "hairColor") spec.hairColor = value;
        else if (field == "facialHairColor") spec.facialHairColor = value;
        else if (field == "outfitColor") spec.outfitColor = value;
    }

    private static string Pick(string[] options) => options[UnityEngine.Random.Range(0, options.Length)];

    private void Randomize()
    {
        spec.skin = Pick(AvatarParts.SkinIds); spec.hair = Pick(AvatarParts.HairFront);
        spec.hairColor = Pick(AvatarParts.PaletteIds); spec.eyes = Pick(AvatarParts.Eyes);
        spec.mouth = Pick(AvatarParts.Mouth); spec.facialHair = Pick(AvatarParts.FacialHair);
        spec.facialHairColor = Pick(AvatarParts.PaletteIds); spec.hat = Pick(AvatarParts.Hat);
        spec.glasses = Pick(AvatarParts.Glasses); spec.outfit = Pick(AvatarParts.Outfit);
        spec.outfitColor = Pick(AvatarParts.PaletteIds); spec.bg = Pick(AvatarParts.PaletteIds);
        spec.frame = Pick(AvatarParts.Frame); Refresh();
    }

    private void Reset() { spec = AvatarSpec.FromJson(original.ToJson()); Refresh(); }

    public void Refresh()
    {
        if (!compositor.Apply(spec)) SetStatus("A character layer is missing. Use the simple builder.");
    }

    private void Save()
    {
        if (!spec.IsValid()) { SetStatus("Choose valid character parts first."); return; }
        save.interactable = false; SetStatus("Saving character…"); bridge.SaveSpec(spec.ToJson());
    }

    private void OnSaved(bool ok, string message)
    {
        save.interactable = true; SetStatus(message);
        if (ok) original = AvatarSpec.FromJson(spec.ToJson());
    }
}

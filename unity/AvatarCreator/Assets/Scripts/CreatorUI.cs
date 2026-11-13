using System;
using System.Collections.Generic;
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
    private RectTransform tabsContent;
    private Text status;
    private Button save;
    private Button undo;
    private Button redo;
    private readonly List<string> undoHistory = new List<string>();
    private readonly List<string> redoHistory = new List<string>();
    private string tab = "hair";
    private bool landscape;
    private Font font;
    private static readonly Color Ink = new Color32(35, 47, 65, 255);
    private static readonly Color Paper = new Color32(255, 253, 245, 255);
    private static readonly Color Mint = new Color32(196, 242, 158, 255);
    private static readonly Color Lilac = new Color32(231, 220, 255, 255);
    private static readonly Color Soft = new Color32(248, 246, 238, 255);

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

    private static void Selected(Button button, bool selected, Color selectedColor, bool swatch)
    {
        button.GetComponent<Image>().color = swatch || selected ? selectedColor : Soft;
        if (!selected) return;
        UnityEngine.UI.Outline outline = button.gameObject.AddComponent<UnityEngine.UI.Outline>();
        outline.effectColor = Ink;
        outline.effectDistance = new Vector2(2, -2);
    }

    private static string LabelFor(string value)
    {
        if (value == "facialHair") return "Beard";
        if (value == "bg") return "Backdrop";
        if (value.StartsWith("s") && value.Length == 2 && char.IsDigit(value[1])) return "Tone " + value[1];
        if (value.StartsWith("c") && int.TryParse(value.Substring(1), out int color)) return "Color " + color;
        return char.ToUpperInvariant(value[0]) + value.Substring(1);
    }

    private void AddThumbnail(Button button, string value)
    {
        string slot = tab == "skin" || tab == "face" ? "body" : tab == "hair" ? "hairFront" : tab;
        if (slot == "bg" || slot == "frame") return;
        string part = tab == "skin" ? spec.face : value;
        Sprite sprite = compositor.PreviewSprite(slot, part);
        if (sprite == null) return;
        RectTransform thumb = new GameObject("Preview", typeof(RectTransform), typeof(Image)).GetComponent<RectTransform>();
        thumb.SetParent(button.transform, false);
        Image image = thumb.GetComponent<Image>(); image.sprite = sprite; image.preserveAspect = true;
        image.raycastTarget = false;
        if (tab == "skin") image.color = Catalog.ColorFor(value, true);
        else if (tab == "face") image.color = Catalog.ColorFor(spec.skin, true);
        else if (tab == "hair") image.color = Catalog.ColorFor(spec.hairColor, false);
        else if (tab == "facialHair") image.color = Catalog.ColorFor(spec.facialHairColor, false);
        else if (tab == "outfit") image.color = Catalog.ColorFor(spec.outfitColor, false);
        Place(thumb, Vector2.zero, new Vector2(0, 1), new Vector2(4, 4), new Vector2(46, -4));
        Text label = button.transform.Find("Label").GetComponent<Text>();
        label.fontSize = 12;
        Place(label.rectTransform, Vector2.zero, Vector2.one, new Vector2(46, 0), new Vector2(-2, 0));
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
        Button back = Action("Back", header, "Back", () => bridge.Navigate("/me.html"), Soft);
        Place(back.GetComponent<RectTransform>(), new Vector2(0, 0), new Vector2(0, 1),
            new Vector2(12, 18), new Vector2(76, -18));
        save = Action("Save", header, "Save", Save, Mint);
        Place(save.GetComponent<RectTransform>(), new Vector2(1, 0), Vector2.one,
            new Vector2(-84, 18), new Vector2(-12, -18));
        Text title = Label("Title", header, "YOUR LOOK", 17, TextAnchor.MiddleCenter);
        Place(title.rectTransform, Vector2.zero, Vector2.one, new Vector2(82, 29), new Vector2(-82, 0));
        status = Label("Status", header, "Choose a look, then save.", 11, TextAnchor.MiddleCenter);
        Place(status.rectTransform, Vector2.zero, Vector2.one, new Vector2(82, 3), new Vector2(-82, -40));

        footer = Panel("Controls", canvasNode.transform, Paper);
        RectTransform tabs = Scroll("Tabs", footer, true);
        Place(tabs, new Vector2(0, 1), Vector2.one, new Vector2(12, -60), new Vector2(-12, -8));
        tabsContent = tabs.GetComponent<ScrollRect>().content;
        string[] names = { "skin", "face", "hair", "brows", "eyes", "nose", "mouth", "facialHair", "hat", "glasses", "outfit", "bg", "frame" };
        for (int index = 0; index < names.Length; index++)
        {
            string choice = names[index];
            Button button = Action("Tab_" + choice, tabsContent, LabelFor(choice), () => {
                tab = choice; optionsContent.anchoredPosition = Vector2.zero; BuildOptions();
            }, Soft);
            RectTransform rect = button.GetComponent<RectTransform>();
            Place(rect, new Vector2(0, 0), new Vector2(0, 1), new Vector2(index * 96, 0), new Vector2(index * 96 + 90, 0));
        }
        tabsContent.sizeDelta = new Vector2(names.Length * 96, 0);
        RectTransform options = Scroll("Options", footer, false);
        Place(options, Vector2.zero, Vector2.one, new Vector2(12, 62), new Vector2(-12, -66));
        optionsContent = options.GetComponent<ScrollRect>().content;

        Text preview = Label("PreviewLabel", canvasNode.transform, "LIVE PREVIEW", 11, TextAnchor.MiddleCenter);
        preview.raycastTarget = false;
        Place(preview.rectTransform, new Vector2(0, 1), Vector2.one, new Vector2(0, -104), new Vector2(0, -78));

        RectTransform actions = Panel("Actions", footer, Paper);
        Place(actions, Vector2.zero, new Vector2(1, 0), new Vector2(12, 6), new Vector2(-12, 56));
        string[] labels = { "Undo", "Redo", "Shuffle", "Reset" };
        Action[] handlers = { Undo, Redo, Randomize, Reset };
        for (int index = 0; index < labels.Length; index++)
        {
            int number = index;
            Button button = Action(labels[index], actions, labels[index], handlers[index], Soft);
            button.transform.Find("Label").GetComponent<Text>().fontSize = 14;
            Place(button.GetComponent<RectTransform>(), new Vector2(number * .25f, 0),
                new Vector2((number + 1) * .25f, 1), new Vector2(2, 0), new Vector2(-2, 0));
            if (index == 0) undo = button;
            if (index == 1) redo = button;
        }
        UpdateHistoryButtons();
        Resize(); BuildOptions();
    }

    private void Update() { if (landscape != (Screen.width > Screen.height)) { Resize(); BuildOptions(); } }

    private void Resize()
    {
        landscape = Screen.width > Screen.height;
        if (landscape)
        {
            Place(footer, new Vector2(.47f, 0), Vector2.one, Vector2.zero, new Vector2(0, -76));
            compositor.GetComponent<IdleAnimator>().SetRestPosition(new Vector3(-.7f, 0, 0));
            Camera.main.orthographicSize = 1f;
        }
        else
        {
            Place(footer, Vector2.zero, new Vector2(1, 0), Vector2.zero, new Vector2(0, 288));
            compositor.GetComponent<IdleAnimator>().SetRestPosition(new Vector3(0, .3f, 0));
            Camera.main.orthographicSize = 1.4f;
        }
    }

    private string[] Options()
    {
        switch (tab)
        {
            case "skin": return AvatarParts.SkinIds;
            case "face": return AvatarParts.Body;
            case "hair": return AvatarParts.HairFront;
            case "brows": return AvatarParts.Brows;
            case "eyes": return AvatarParts.Eyes;
            case "nose": return AvatarParts.Nose;
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
        foreach (Transform child in tabsContent)
            SelectedTab(child.GetComponent<Button>(), child.name == "Tab_" + tab);
        foreach (Transform child in optionsContent) Destroy(child.gameObject);
        string[] values = Options();
        int columns = landscape ? 4 : 3;
        int rows = Mathf.CeilToInt(values.Length / (float)columns);
        int top = 0;
        for (int index = 0; index < values.Length; index++)
        {
            string value = values[index]; int col = index % columns; int row = index / columns;
            Color color = tab == "skin" ? Catalog.ColorFor(value, true) : tab == "bg" ? Catalog.ColorFor(value, false) : Lilac;
            Button button = Action("Option_" + value, optionsContent, LabelFor(value), () => Choose(value), color);
            AddThumbnail(button, value);
            Selected(button, CurrentValue() == value, color, tab == "skin" || tab == "bg");
            Place(button.GetComponent<RectTransform>(), new Vector2(col / (float)columns, 1),
                new Vector2((col + 1) / (float)columns, 1), new Vector2(3, -row * 58 - 54), new Vector2(-3, -row * 58 - 2));
        }
        top += rows * 58;
        string colorField = tab == "hair" ? "hairColor" : tab == "facialHair" ? "facialHairColor"
            : tab == "outfit" ? "outfitColor" : "";
        if (colorField != "")
        {
            Text label = Label("ColorLabel", optionsContent, "COLOR", 13, TextAnchor.MiddleLeft);
            Place(label.rectTransform, new Vector2(0, 1), Vector2.one, new Vector2(3, -top - 26), new Vector2(-3, -top));
            top += 28;
            for (int index = 0; index < AvatarParts.PaletteIds.Length; index++)
            {
                string value = AvatarParts.PaletteIds[index]; int col = index % columns; int row = index / columns;
                Color color = Catalog.ColorFor(value, false);
                Button button = Action("Color_" + value, optionsContent, LabelFor(value),
                    () => { SetColor(colorField, value); Refresh(); BuildOptions(); }, color);
                Selected(button, CurrentColor(colorField) == value, color, true);
                Place(button.GetComponent<RectTransform>(), new Vector2(col / (float)columns, 1),
                    new Vector2((col + 1) / (float)columns, 1), new Vector2(3, -top - row * 58 - 54), new Vector2(-3, -top - row * 58 - 2));
            }
            top += Mathf.CeilToInt(AvatarParts.PaletteIds.Length / (float)columns) * 58;
        }
        optionsContent.sizeDelta = new Vector2(0, top);
    }

    private static void SelectedTab(Button button, bool selected)
    {
        button.GetComponent<Image>().color = selected ? Mint : Soft;
        button.transform.Find("Label").GetComponent<Text>().fontStyle = selected ? FontStyle.Bold : FontStyle.Normal;
    }

    private string CurrentValue()
    {
        switch (tab)
        {
            case "skin": return spec.skin;
            case "face": return spec.face;
            case "hair": return spec.hair;
            case "brows": return spec.brows;
            case "eyes": return spec.eyes;
            case "nose": return spec.nose;
            case "mouth": return spec.mouth;
            case "facialHair": return spec.facialHair;
            case "hat": return spec.hat;
            case "glasses": return spec.glasses;
            case "outfit": return spec.outfit;
            case "bg": return spec.bg;
            default: return spec.frame;
        }
    }

    private string CurrentColor(string field) => field == "hairColor" ? spec.hairColor
        : field == "facialHairColor" ? spec.facialHairColor : spec.outfitColor;

    private void Choose(string value)
    {
        if (CurrentValue() == value) return;
        Remember();
        switch (tab)
        {
            case "skin": spec.skin = value; break;
            case "face": spec.face = value; break;
            case "hair": spec.hair = value; break;
            case "brows": spec.brows = value; break;
            case "eyes": spec.eyes = value; break;
            case "nose": spec.nose = value; break;
            case "mouth": spec.mouth = value; break;
            case "facialHair": spec.facialHair = value; break;
            case "hat": spec.hat = value; break;
            case "glasses": spec.glasses = value; break;
            case "outfit": spec.outfit = value; break;
            case "bg": spec.bg = value; break;
            case "frame": spec.frame = value; break;
        }
        Refresh(); BuildOptions();
    }

    private void SetColor(string field, string value)
    {
        if (CurrentColor(field) == value) return;
        Remember();
        if (field == "hairColor") spec.hairColor = value;
        else if (field == "facialHairColor") spec.facialHairColor = value;
        else if (field == "outfitColor") spec.outfitColor = value;
    }

    private static string Pick(string[] options) => options[UnityEngine.Random.Range(0, options.Length)];

    private void Randomize()
    {
        Remember();
        spec.skin = Pick(AvatarParts.SkinIds); spec.hair = Pick(AvatarParts.HairFront);
        spec.face = Pick(AvatarParts.Body); spec.nose = Pick(AvatarParts.Nose);
        spec.hairColor = Pick(AvatarParts.PaletteIds); spec.brows = Pick(AvatarParts.Brows); spec.eyes = Pick(AvatarParts.Eyes);
        spec.mouth = Pick(AvatarParts.Mouth); spec.facialHair = Pick(AvatarParts.FacialHair);
        spec.facialHairColor = Pick(AvatarParts.PaletteIds); spec.hat = Pick(AvatarParts.Hat);
        spec.glasses = Pick(AvatarParts.Glasses); spec.outfit = Pick(AvatarParts.Outfit);
        spec.outfitColor = Pick(AvatarParts.PaletteIds); spec.bg = Pick(AvatarParts.PaletteIds);
        spec.frame = Pick(AvatarParts.Frame); Refresh(); BuildOptions();
    }

    private void Reset()
    {
        if (spec.ToJson() == original.ToJson()) return;
        Remember(); spec = AvatarSpec.FromJson(original.ToJson()); Refresh(); BuildOptions();
    }

    private void Remember()
    {
        undoHistory.Add(spec.ToJson());
        if (undoHistory.Count > 30) undoHistory.RemoveAt(0);
        redoHistory.Clear(); UpdateHistoryButtons();
    }

    private void Undo()
    {
        if (undoHistory.Count == 0) return;
        redoHistory.Add(spec.ToJson());
        int last = undoHistory.Count - 1;
        spec = AvatarSpec.FromJson(undoHistory[last]); undoHistory.RemoveAt(last);
        Refresh(); BuildOptions(); UpdateHistoryButtons();
    }

    private void Redo()
    {
        if (redoHistory.Count == 0) return;
        undoHistory.Add(spec.ToJson());
        int last = redoHistory.Count - 1;
        spec = AvatarSpec.FromJson(redoHistory[last]); redoHistory.RemoveAt(last);
        Refresh(); BuildOptions(); UpdateHistoryButtons();
    }

    private void UpdateHistoryButtons()
    {
        if (undo != null) undo.interactable = undoHistory.Count > 0;
        if (redo != null) redo.interactable = redoHistory.Count > 0;
    }

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

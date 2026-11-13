using System.Collections.Generic;
using UnityEngine;

public sealed class LayerCompositor : MonoBehaviour
{
    private Catalog catalog;
    private readonly Dictionary<string, SpriteRenderer> renderers = new Dictionary<string, SpriteRenderer>();
    public bool Ready => catalog != null && catalog.Ready;
    public SpriteRenderer Eyes => renderers["eyes"];
    public SpriteRenderer Brows => renderers["brows"];
    public SpriteRenderer Mouth => renderers["mouth"];
    public SpriteRenderer Hat => renderers["hat"];
    public Sprite PreviewSprite(string slot, string id) => catalog.Sprite(slot, id);

    public void Initialize(Catalog source)
    {
        catalog = source;
        for (int index = 0; index < AvatarParts.Slots.Length; index++)
        {
            string slot = AvatarParts.Slots[index];
            GameObject layer = new GameObject("Layer_" + slot);
            layer.transform.SetParent(transform, false);
            SpriteRenderer renderer = layer.AddComponent<SpriteRenderer>();
            renderer.sortingOrder = AvatarParts.ZOrders[index];
            renderers.Add(slot, renderer);
        }
    }

    public bool Apply(AvatarSpec spec)
    {
        if (!catalog.Ready || !spec.IsValid()) return false;
        foreach (string slot in AvatarParts.Slots)
        {
            string id = PartFor(spec, slot);
            Sprite sprite = catalog.Sprite(slot, id);
            if (sprite == null) return false;
            SpriteRenderer renderer = renderers[slot];
            renderer.sprite = sprite;
            renderer.color = TintFor(spec, slot);
        }
        return true;
    }

    private static string PartFor(AvatarSpec spec, string slot)
    {
        switch (slot)
        {
            case "bg": return "disc";
            case "hairBack": case "hairFront": return spec.hair;
            case "body": return spec.face;
            case "nose": return spec.nose;
            case "outfit": return spec.outfit;
            case "mouth": return spec.mouth;
            case "eyes": return spec.eyes;
            case "brows": return spec.brows;
            case "facialHair": return spec.facialHair;
            case "glasses": return spec.glasses;
            case "hat": return spec.hat;
            case "frame": return spec.frame;
            default: return "none";
        }
    }

    private static Color TintFor(AvatarSpec spec, string slot)
    {
        switch (slot)
        {
            case "bg": return Catalog.ColorFor(spec.bg, false);
            case "hairBack": case "hairFront": return Catalog.ColorFor(spec.hairColor, false);
            case "body": return Catalog.ColorFor(spec.skin, true);
            case "outfit": return Catalog.ColorFor(spec.outfitColor, false);
            case "facialHair": return Catalog.ColorFor(spec.facialHairColor, false);
            default: return Color.white;
        }
    }
}


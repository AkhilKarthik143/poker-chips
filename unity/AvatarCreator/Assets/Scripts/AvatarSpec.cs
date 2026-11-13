using System;
using UnityEngine;

[Serializable]
public sealed class AvatarSpec
{
    public int v = 2;
    public string skin = "s3";
    public string face = "base";
    public string hair = "crop";
    public string hairColor = "c10";
    public string eyes = "round";
    public string brows = "none";
    public string nose = "none";
    public string mouth = "smile";
    public string facialHair = "none";
    public string facialHairColor = "c10";
    public string hat = "none";
    public string glasses = "none";
    public string outfit = "tee";
    public string outfitColor = "c5";
    public string bg = "c2";
    public string frame = "plain";

    public static AvatarSpec Default() => new AvatarSpec();

    public static AvatarSpec FromJson(string json)
    {
        if (string.IsNullOrEmpty(json)) return Default();
        try
        {
            AvatarSpec result = JsonUtility.FromJson<AvatarSpec>(json);
            if (result != null && string.IsNullOrEmpty(result.brows)) result.brows = "none";
            if (result != null && string.IsNullOrEmpty(result.face)) result.face = "base";
            if (result != null && string.IsNullOrEmpty(result.nose)) result.nose = "none";
            return result != null && result.IsValid() ? result : Default();
        }
        catch (Exception) { return Default(); }
    }

    public string ToJson() => JsonUtility.ToJson(this);

    public bool IsValid()
    {
        return v == AvatarParts.ManifestVersion &&
            AvatarParts.Has(AvatarParts.SkinIds, skin) &&
            AvatarParts.Has(AvatarParts.Body, face) && AvatarParts.Has(AvatarParts.Nose, nose) &&
            AvatarParts.Has(AvatarParts.HairFront, hair) && AvatarParts.Has(AvatarParts.HairBack, hair) &&
            AvatarParts.Has(AvatarParts.PaletteIds, hairColor) &&
            AvatarParts.Has(AvatarParts.Eyes, eyes) && AvatarParts.Has(AvatarParts.Mouth, mouth) &&
            AvatarParts.Has(AvatarParts.Brows, brows) &&
            AvatarParts.Has(AvatarParts.FacialHair, facialHair) &&
            AvatarParts.Has(AvatarParts.PaletteIds, facialHairColor) &&
            AvatarParts.Has(AvatarParts.Hat, hat) && AvatarParts.Has(AvatarParts.Glasses, glasses) &&
            AvatarParts.Has(AvatarParts.Outfit, outfit) && AvatarParts.Has(AvatarParts.PaletteIds, outfitColor) &&
            AvatarParts.Has(AvatarParts.PaletteIds, bg) && AvatarParts.Has(AvatarParts.Frame, frame);
    }
}


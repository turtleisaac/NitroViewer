/*
 * NitroViewer - a modern web replacement for Tinke, powered by Nds4j.
 * Released under the GNU GPL v3 (see LICENSE).
 */

package com.nitroviewer.core;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;

import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;

/**
 * Family and language game-db files. The web app reads the same folders.
 */
final class GameDb
{
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Map<String, JsonNode> FILES = new HashMap<String, JsonNode>();


    /** Not instantiated. */
    private GameDb()
    {
    }


    /** Scan direction for one entry, from the family file plus a language override. */
    static Boolean frontToBack(String gameCode, String narcPath, int entryIndex)
    {
        return frontToBack(documentOrEmpty(gameCode), gameCode, narcPath, entryIndex);
    }


    /** Scan direction after merging one family document with one language document. */
    static Boolean frontToBackFiles(String familyJson, String languageJson, String gameCode, String narcPath, int entryIndex)
    {
        return frontToBack(filesOrEmpty(familyJson, languageJson, gameCode), gameCode, narcPath, entryIndex);
    }


    /**
     * Scan direction in one game-db document. Does not touch the shipped cache.
     * @param json a <code>String</code> game-db document
     * @param gameCode a <code>String</code> game code
     * @param narcPath a <code>String</code> FNT path, already normalised
     * @param entryIndex an <code>int</code> index inside the NARC
     * @return <code>Boolean.TRUE</code> for front-to-back, <code>Boolean.FALSE</code> for back-to-front, or <code>null</code> when the document has no direction
     */
    static Boolean frontToBackIn(String json, String gameCode, String narcPath, int entryIndex)
    {
        JsonNode root = read(json);
        if (root == null || !root.isObject())
            throw new IllegalStateException("game db is not an object");
        return frontToBack(root, gameCode, narcPath, entryIndex);
    }


    /**
     * Returns the scan direction one parsed document declares for this entry
     * @param root a <code>JsonNode</code> game-db object
     * @param gameCode a <code>String</code> game code
     * @param narcPath a <code>String</code> FNT path, already normalised
     * @param entryIndex an <code>int</code> index inside the NARC
     * @return <code>Boolean.TRUE</code> for front-to-back, <code>Boolean.FALSE</code> for back-to-front, or <code>null</code> when the document has no direction
     */
    private static Boolean frontToBack(JsonNode root, String gameCode, String narcPath, int entryIndex)
    {
        if (gameCode == null || narcPath == null || entryIndex < 0)
            return null;

        JsonNode games = root.get("games");
        if (games == null || !games.isObject())
            return null;

        JsonNode game = game(games, gameCode);
        if (game == null)
            return null;

        JsonNode narcs = game.get("narcs");
        if (narcs == null || !narcs.isObject())
            return null;

        JsonNode narc = narcs.get(narcPath);
        if (narc == null || !narc.isObject())
            return null;

        return direction(scanDirection(narc, entryIndex));
    }


    /**
     * Picks the scan direction the same way <code>resolveRenderHints</code> does
     * @param narc a <code>JsonNode</code> for one NARC
     * @param entryIndex an <code>int</code> index inside the NARC
     * @return <code>front-to-back</code>, <code>back-to-front</code>, or <code>null</code>
     */
    private static String scanDirection(JsonNode narc, int entryIndex)
    {
        String direction = text(narc.get("render"), "scanDirection");

        JsonNode cipher = narc.get("cipher");
        if (cipher != null && cipher.isObject() && cipherMatches(cipher, entryIndex))
            direction = text(cipher, "scanDirection");

        JsonNode entries = narc.get("entries");
        if (entries != null && entries.isObject())
        {
            JsonNode entry = entries.get(Integer.toString(entryIndex));
            if (entry != null && entry.hasNonNull("scanDirection"))
                direction = text(entry, "scanDirection");
        }
        return direction;
    }


    /**
     * True when this entry is one of the ciphered scans
     * @param cipher a <code>JsonNode</code> cipher rule
     * @param entryIndex an <code>int</code> index inside the NARC
     * @return <code>true</code> when the rule applies
     */
    private static boolean cipherMatches(JsonNode cipher, int entryIndex)
    {
        if (entryIndex < 0)
            return false;
        if (!cipher.hasNonNull("indexMod"))
            return true;

        int mod = cipher.get("indexMod").asInt();
        if (mod <= 0)
            return false;

        int rem = cipher.hasNonNull("indexRem") ? cipher.get("indexRem").asInt() : 0;
        return Math.floorMod(entryIndex, mod) == rem;
    }


    /**
     * Best game entry: an exact key wins over a <code>PREFIX*</code> wildcard
     * @param games a <code>JsonNode</code> of game-code keys
     * @param gameCode a <code>String</code> game code
     * @return the game object, or <code>null</code>
     */
    private static JsonNode game(JsonNode games, String gameCode)
    {
        String code = gameCode.toUpperCase();
        if (games.has(code))
            return games.get(code);

        Iterator<String> names = games.fieldNames();
        while (names.hasNext())
        {
            String key = names.next();
            String upper = key.toUpperCase();
            if (upper.endsWith("*") && code.startsWith(upper.substring(0, upper.length() - 1)))
                return games.get(key);
        }

        return null;
    }


    /** @param scanDirection <code>front-to-back</code>, <code>back-to-front</code>, or anything else */
    private static Boolean direction(String scanDirection)
    {
        if ("front-to-back".equals(scanDirection))
            return Boolean.TRUE;
        if ("back-to-front".equals(scanDirection))
            return Boolean.FALSE;
        return null;
    }


    /**
     * Reads a string field
     * @param node a <code>JsonNode</code>, or <code>null</code>
     * @param field a <code>String</code> field name
     * @return the text, or <code>null</code> when the field is missing or not a string
     */
    private static String text(JsonNode node, String field)
    {
        if (node == null || !node.hasNonNull(field) || !node.get(field).isTextual())
            return null;
        return node.get(field).asText();
    }


    private static JsonNode documentOrEmpty(String gameCode)
    {
        JsonNode root = mergedDocument(gameCode);
        if (root != null)
            return root;

        return MAPPER.createObjectNode();
    }


    private static JsonNode filesOrEmpty(String familyJson, String languageJson, String gameCode)
    {
        if (gameCode == null)
            return MAPPER.createObjectNode();

        JsonNode root = documentFor(gameCode.toUpperCase(), readFile(familyJson), readFile(languageJson));
        if (root != null)
            return root;

        return MAPPER.createObjectNode();
    }


    private static JsonNode readFile(String json)
    {
        if (json == null)
            return null;

        return gameBody(read(json));
    }


    private static JsonNode mergedDocument(String gameCode)
    {
        if (gameCode == null)
            return null;

        String code = gameCode.toUpperCase();
        if (code.length() < 3)
            return null;

        return documentFor(code, familyNode(code), languageFor(code));
    }


    private static JsonNode languageFor(String code)
    {
        if (code.length() != 4)
            return null;

        return languageNode(code);
    }


    private static JsonNode familyNode(String code)
    {
        return gameBody(readResource("/" + code.substring(0, 3) + "/gamedb.json"));
    }


    private static JsonNode languageNode(String code)
    {
        String path = "/" + code.substring(0, 3) + "/" + code.charAt(3) + "/gamedb.json";
        return gameBody(readResource(path));
    }


    private static JsonNode documentFor(String code, JsonNode family, JsonNode language)
    {
        if (code.length() < 3)
            return null;

        JsonNode exact = exactFrom(code, family, language);
        if (family == null && exact == null)
            return null;

        ObjectNode root = MAPPER.createObjectNode();
        ObjectNode games = root.putObject("games");
        putFamily(games, code, family);
        putExact(games, code, exact);

        return root;
    }


    private static JsonNode exactFrom(String code, JsonNode family, JsonNode language)
    {
        if (code.length() != 4 || language == null)
            return null;
        if (family == null)
            return language;

        return deepMerge(family, language);
    }


    private static void putFamily(ObjectNode games, String code, JsonNode family)
    {
        if (family == null)
            return;

        games.set(code.substring(0, 3) + "*", family);
    }


    private static void putExact(ObjectNode games, String code, JsonNode exact)
    {
        if (exact == null)
            return;

        games.set(code, exact);
    }


    private static JsonNode gameBody(JsonNode file)
    {
        if (file == null || !file.isObject())
            return null;

        ObjectNode body = file.deepCopy();
        body.remove("version");
        body.remove("_source");

        return body;
    }


    private static JsonNode deepMerge(JsonNode base, JsonNode override)
    {
        if (!base.isObject() || !override.isObject())
            return override;

        ObjectNode out = base.deepCopy();
        Iterator<String> names = override.fieldNames();
        while (names.hasNext())
            copyField(out, base, override, names.next());

        return out;
    }


    private static void copyField(ObjectNode out, JsonNode base, JsonNode override, String key)
    {
        JsonNode left = base.get(key);
        JsonNode right = override.get(key);

        if (left == null)
            out.set(key, right);
        else
            out.set(key, deepMerge(left, right));
    }


    private static JsonNode readResource(String path)
    {
        synchronized (GameDb.class)
        {
            if (FILES.containsKey(path))
                return FILES.get(path);

            JsonNode node = openResource(path);
            FILES.put(path, node);
            return node;
        }
    }


    private static JsonNode openResource(String path)
    {
        InputStream in = GameDb.class.getResourceAsStream(path);
        if (in == null)
            return null;

        try
        {
            return readTree(in);
        }
        finally
        {
            close(in);
        }
    }


    private static JsonNode readTree(InputStream in)
    {
        try
        {
            JsonNode node = MAPPER.readTree(in);
            if (!node.isObject())
                throw new IllegalStateException("gamedb.json is not an object");

            return node;
        }
        catch (IOException e)
        {
            throw new IllegalStateException("could not read gamedb.json", e);
        }
    }


    private static void close(InputStream in)
    {
        try
        {
            in.close();
        }
        catch (IOException ignored)
        {}
    }


    /**
     * Parses one JSON document
     * @param json a <code>String</code> of JSON
     * @return the root <code>JsonNode</code>
     */
    private static JsonNode read(String json)
    {
        try
        {
            return MAPPER.readTree(json);
        }
        catch (IOException e)
        {
            throw new IllegalStateException("could not read gamedb.json", e);
        }
    }
}

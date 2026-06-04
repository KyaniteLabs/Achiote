# Local Access Playbook

Local access is part of Achiote's research job. A correct dish that the user cannot source is not useful yet.

## Location handling

Ask for the user's current location when sourcing matters. Accept:

- city;
- metro area;
- state/province;
- country;
- "near me" style rough context.

Do not require exact address.

## Access ladder

For each ingredient or sensory role, build this ladder:

1. Pantry or ordinary grocery proxy.
2. Mainstream grocery item.
3. Specialty or ethnic market category.
4. Online source category or search phrase.
5. Sensory substitute if exact sourcing fails.

## Ingredient role first

Do not source by name alone. Source by job.

Examples:

| Role | Exact ingredient may be | Accessible proxy may be |
| --- | --- | --- |
| green starch body | green banana, yautia, taro | green plantain, potato plus plantain |
| leaf aroma/enclosure | banana leaf, corn husk | parchment steam test, cabbage leaf for enclosure only |
| floral milk note | rose syrup | milk plus rose water plus simple syrup |
| sour herb broth | regional sorrel/dill herb | dill, parsley, lemon/vinegar balance |
| toasted nut candy | jaggery peanut chikki | peanut brittle plus jaggery/molasses note |

## Search behavior

When live web is available:

- search ingredient category plus city/metro;
- search likely store types, not just exact product;
- prefer store pages, market pages, and current listings for availability;
- include date searched;
- do not invent stock or price.

When live web is unavailable:

- give likely store categories;
- give search phrases the host can run later;
- label the guidance as unverified.

## Output template

```text
Local access path for [location]

| Sensory role | Accessible first move | More exact source path | Substitute if blocked | Verification status |
| --- | --- | --- | --- | --- |
| ... | ... | ... | ... | ... |
```

## Cheap-first rule

The first move should usually be a cheap test. Specialty sourcing comes after the cue proves the mechanism matters.

const unsavedDataKeys = new Set<string>();

export const setHasUnsavedData = (key: string, hasUnsaved: boolean) => {
    if (hasUnsaved) {
        unsavedDataKeys.add(key);
    } else {
        unsavedDataKeys.delete(key);
    }
};

export const hasAnyUnsavedData = () => {
    return unsavedDataKeys.size > 0;
};

-- A virtual folder and a record cannot use the same name in the same directory.
CREATE TRIGGER folders_disallow_record_name_on_insert
BEFORE INSERT ON folders
WHEN EXISTS (SELECT 1 FROM records WHERE folder_id IS NEW.parent_id AND name=NEW.name)
BEGIN SELECT RAISE(ABORT,'PATH_CONFLICT'); END;
CREATE TRIGGER folders_disallow_record_name_on_update
BEFORE UPDATE OF parent_id,name ON folders
WHEN EXISTS (SELECT 1 FROM records WHERE folder_id IS NEW.parent_id AND name=NEW.name)
BEGIN SELECT RAISE(ABORT,'PATH_CONFLICT'); END;
CREATE TRIGGER records_disallow_folder_name_on_insert
BEFORE INSERT ON records
WHEN EXISTS (SELECT 1 FROM folders WHERE parent_id IS NEW.folder_id AND name=NEW.name)
BEGIN SELECT RAISE(ABORT,'PATH_CONFLICT'); END;
CREATE TRIGGER records_disallow_folder_name_on_update
BEFORE UPDATE OF folder_id,name ON records
WHEN EXISTS (SELECT 1 FROM folders WHERE parent_id IS NEW.folder_id AND name=NEW.name)
BEGIN SELECT RAISE(ABORT,'PATH_CONFLICT'); END;

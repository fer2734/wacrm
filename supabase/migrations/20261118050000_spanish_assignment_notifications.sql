CREATE OR REPLACE FUNCTION public.notify_conversation_assigned()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_name TEXT;
  v_actor_name TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.assigned_agent_id IS NULL THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.assigned_agent_id IS NULL
       OR NEW.assigned_agent_id IS NOT DISTINCT FROM OLD.assigned_agent_id THEN
      RETURN NEW;
    END IF;
  END IF;

  IF auth.uid() IS NOT NULL AND auth.uid() = NEW.assigned_agent_id THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM profiles
    WHERE user_id = NEW.assigned_agent_id
      AND account_id = NEW.account_id
  ) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(NULLIF(name, ''), phone) INTO v_contact_name
  FROM contacts WHERE id = NEW.contact_id;

  IF auth.uid() IS NOT NULL THEN
    SELECT full_name INTO v_actor_name
    FROM profiles WHERE user_id = auth.uid();
  END IF;

  INSERT INTO notifications (
    account_id, user_id, type, conversation_id, contact_id,
    actor_user_id, title, body
  ) VALUES (
    NEW.account_id,
    NEW.assigned_agent_id,
    'conversation_assigned',
    NEW.id,
    NEW.contact_id,
    auth.uid(),
    'Nueva conversación asignada',
    COALESCE(v_actor_name, 'Alguien') || ' te asignó una conversación con '
      || COALESCE(v_contact_name, 'un contacto')
  );

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'Failed to create assignment notification for conversation %: %', NEW.id, SQLERRM;
  RETURN NEW;
END;
$$;


-- Translate existing system notifications while preserving names and read state.
UPDATE public.notifications
SET title = 'Nueva conversación asignada',
    body = regexp_replace(
      regexp_replace(
        regexp_replace(body, ' assigned you a conversation with ', ' te asignó una conversación con '),
        '^Someone te asignó', 'Alguien te asignó'),
      ' con a contact$', ' con un contacto')
WHERE type = 'conversation_assigned' AND title = 'New conversation assigned';

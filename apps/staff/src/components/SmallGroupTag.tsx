// PRD NFR-22: warns that a category with fewer than 5 voters can reveal individual choices.
// Shown next to a category's turnout (Live tab) and results (Results tab); nothing for 0 or 5+.
import { isSmallGroup } from '@vote-kidigit/shared';
import { Tag, Tooltip } from 'antd';
import { useTranslation } from 'react-i18next';

export function SmallGroupTag({ voted }: { voted: number }) {
  const { t } = useTranslation();
  if (!isSmallGroup(voted)) return null;
  return (
    <Tooltip title={t('privacy.smallGroupHelp')}>
      <Tag color="warning" tabIndex={0} aria-description={t('privacy.smallGroupHelp')}>
        {t('privacy.smallGroup')}
      </Tag>
    </Tooltip>
  );
}

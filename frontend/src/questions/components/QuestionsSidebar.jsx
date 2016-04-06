import React, { Component, PropTypes } from "react";
import S from "./QuestionsSidebar.css";

import Icon from "metabase/components/Icon.jsx";

import cx from "classnames";

const QuestionsSidebar = ({ sections, topics, labels }) =>
    <div className={S.sidebar}>
        <ul>
            {sections.map(section =>
                <QuestionSidebarItem key={section.id} href={"/questions/" + section.id} {...section} />
            )}
            <QuestionSidebarSectionTitle name="Topics" href="/questions/edit/topics" />
            {topics.map(topic =>
                <QuestionSidebarItem key={topic.id} href={"/questions/topics/"+topic.slug} {...topic} />
            )}
            <QuestionSidebarSectionTitle name="Labels" href="/questions/edit/labels" />
            {labels.map(label =>
                <QuestionSidebarItem key={label.id} href={"/questions/labels/"+label.slug} {...label} />
            )}
            <li className={S.divider} />
            <QuestionSidebarItem name="Archive" href="/questions/archive" icon="star" />
        </ul>
    </div>

const QuestionSidebarSectionTitle = ({ name, href }) =>
    <li>
        <a href={href} className={S.sectionTitle}>{name}</a>
    </li>

const QuestionSidebarItem = ({ name, icon, href }) =>
    <li>
        <a href={href} className={S.item}>
            <QuestionSidebarIcon icon={icon} width={32} height={32} />
            <span>{name}</span>
        </a>
    </li>

const QuestionSidebarIcon = ({ icon }) =>
    icon.charAt(0) === ":" ?
        <span className={S.icon} style={{ width: 18, height: 18 }}>🐱</span>
    : icon.charAt(0) === "#" ?
        <span className={cx(S.icon, S.colorIcon)} style={{ backgroundColor: icon }}></span>
    :
        <Icon className={S.icon} name={icon} />

export default QuestionsSidebar;